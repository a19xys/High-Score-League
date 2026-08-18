const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { prepareWindowsReleaseBundle } = require("../scripts/lib/windows-release-bundle");

const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_REF = "refs/heads/master";

async function createDistFixture(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-release-bundle-"));
  const appDir = path.join(root, "app");
  const distDir = path.join(appDir, "dist");
  const resourcesDir = path.join(distDir, "win-unpacked", "resources");
  await fsp.mkdir(resourcesDir, { recursive: true });
  const version = options.version || "0.2.0";
  const installerName = `High Score League Setup ${version}.exe`;
  const safeName = `High-Score-League-Setup-${version}.exe`;
  const installer = Buffer.from(options.installerBytes || "canonical-windows-installer-fixture");
  const sha512 = crypto.createHash("sha512").update(installer).digest("base64");
  await fsp.writeFile(path.join(distDir, installerName), installer);
  if (!options.missingBlockmap) await fsp.writeFile(path.join(distDir, `${installerName}.blockmap`), "blockmap fixture", "utf8");
  if (options.ambiguousInstaller) {
    await fsp.writeFile(path.join(distDir, `Duplicate ${version}.exe`), installer);
    await fsp.writeFile(path.join(distDir, `Duplicate ${version}.exe.blockmap`), "duplicate blockmap fixture", "utf8");
  }
  await fsp.writeFile(path.join(resourcesDir, "app-update.yml"), [
    "provider: github",
    "owner: a19xys",
    "repo: High-Score-League",
    "channel: latest",
    "private: false",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(distDir, "latest.yml"), [
    `version: ${version}`,
    "files:",
    `  - url: ${safeName}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${safeName}`,
    `sha512: ${sha512}`,
    "",
  ].join("\n"), "utf8");
  return { appDir, distDir, installer, installerName, root, safeName, sha512, version };
}

async function withReleaseBundle(run, options = {}) {
  const fixture = await createDistFixture(options);
  try {
    const bundle = await prepareWindowsReleaseBundle({
      appDir: fixture.appDir,
      distDir: fixture.distDir,
      bundleDir: path.join(fixture.appDir, "release-bundle"),
      version: fixture.version,
      sourceCommit: options.sourceCommit || SOURCE_COMMIT,
      sourceRef: SOURCE_REF,
    });
    return await run({ ...fixture, bundle });
  } finally {
    await fsp.rm(fixture.root, { recursive: true, force: true });
  }
}

module.exports = { SOURCE_COMMIT, SOURCE_REF, createDistFixture, withReleaseBundle };
