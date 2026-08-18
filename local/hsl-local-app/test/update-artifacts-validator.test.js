const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");
const { validateUpdateArtifacts } = require("../scripts/validate-update-artifacts");

async function withFixture(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-updater-artifacts-"));
  try {
    const distDir = path.join(root, "dist");
    const resourcesDir = path.join(distDir, "win-unpacked", "resources");
    await fsp.mkdir(resourcesDir, { recursive: true });
    const installerName = "High Score League Setup 0.2.0.exe";
    const installerPath = path.join(distDir, installerName);
    const installer = Buffer.from("same-electron-builder-build-fixture");
    const sha512 = crypto.createHash("sha512").update(installer).digest("base64");
    await fsp.writeFile(installerPath, installer);
    await fsp.writeFile(`${installerPath}.blockmap`, "blockmap", "utf8");
    await fsp.writeFile(path.join(resourcesDir, "app-update.yml"), yaml.dump({
      provider: "github",
      owner: "a19xys",
      repo: "High-Score-League",
      channel: "latest",
      private: false,
    }), "utf8");
    await fsp.writeFile(path.join(distDir, "latest.yml"), yaml.dump({
      version: "0.2.0",
      files: [{
        url: "hsl-local-app-setup-0.2.0.exe",
        sha512,
        size: installer.length,
      }],
      path: "hsl-local-app-setup-0.2.0.exe",
      sha512,
    }), "utf8");
    await run({ distDir, installerName, resourcesDir });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("artifact validator matches the real installer hash even when safeArtifactName differs", async () => {
  await withFixture(async ({ distDir, installerName }) => {
    const result = await validateUpdateArtifacts({ distDir, expectedVersion: "0.2.0", quiet: true });
    assert.equal(result.localArtifactName, installerName);
    assert.equal(result.metadataArtifactName, "hsl-local-app-setup-0.2.0.exe");
    assert.equal(result.safeArtifactNameDiffers, true);
    assert.equal(result.channel, "latest");
  });
});

test("artifact validator rejects credentials and installer metadata mismatches", async () => {
  await withFixture(async ({ distDir, resourcesDir }) => {
    await fsp.writeFile(path.join(resourcesDir, "app-update.yml"), yaml.dump({
      provider: "github",
      owner: "a19xys",
      repo: "High-Score-League",
      channel: "latest",
      token: "forbidden",
    }), "utf8");
    await assert.rejects(
      () => validateUpdateArtifacts({ distDir, expectedVersion: "0.2.0", quiet: true }),
      /credencial prohibida/,
    );
  });
});

