const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { prepareWindowsReleaseBundle, validateWindowsReleaseBundle } = require("../scripts/lib/windows-release-bundle");
const { SOURCE_COMMIT, SOURCE_REF, createDistFixture, withReleaseBundle } = require("./windows-release-fixture");

test("release bundle uses latest.yml safe name and records coherent hashes/provenance", async () => {
  await withReleaseBundle(async ({ bundle, installer, installerName, safeName }) => {
    const names = (await fsp.readdir(bundle.bundleDir)).sort();
    assert.deepEqual(names, [safeName, `${safeName}.blockmap`, "latest.yml", "release-manifest.json"].sort());
    assert.notEqual(installerName, safeName);
    assert.deepEqual(await fsp.readFile(path.join(bundle.bundleDir, safeName)), installer);
    assert.equal(bundle.manifest.schemaVersion, 1);
    assert.equal(bundle.manifest.version, "0.2.0");
    assert.equal(bundle.manifest.tag, "v0.2.0");
    assert.equal(bundle.manifest.sourceCommit, SOURCE_COMMIT);
    assert.equal(bundle.manifest.sourceRef, SOURCE_REF);
    assert.equal(bundle.manifest.assets.installer.name, safeName);
    assert.equal(bundle.manifest.assets.blockmap.name, `${safeName}.blockmap`);
    assert.equal(bundle.manifest.assets.installer.sha256, crypto.createHash("sha256").update(installer).digest("hex"));
    assert.match(bundle.manifest.assets.installer.sha512, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(JSON.stringify(bundle.manifest).includes(bundle.bundleDir), false);
  });
});

test("release bundle validator detects local mutation", async () => {
  await withReleaseBundle(async ({ bundle, safeName }) => {
    await fsp.appendFile(path.join(bundle.bundleDir, safeName), "mutated");
    await assert.rejects(() => validateWindowsReleaseBundle({ bundleDir: bundle.bundleDir }), /SHA-256|Size local/);
  });
});

test("release bundle fails on missing blockmap, ambiguous installer and version mismatch", async () => {
  const missing = await createDistFixture({ missingBlockmap: true });
  try {
    await assert.rejects(() => prepareWindowsReleaseBundle({
      appDir: missing.appDir,
      distDir: missing.distDir,
      bundleDir: path.join(missing.appDir, "release-bundle"),
      version: missing.version,
      sourceCommit: SOURCE_COMMIT,
      sourceRef: SOURCE_REF,
    }), /Falta el blockmap/);
  } finally {
    await fsp.rm(missing.root, { recursive: true, force: true });
  }

  const ambiguous = await createDistFixture({ ambiguousInstaller: true });
  try {
    await assert.rejects(() => prepareWindowsReleaseBundle({
      appDir: ambiguous.appDir,
      distDir: ambiguous.distDir,
      bundleDir: path.join(ambiguous.appDir, "release-bundle"),
      version: ambiguous.version,
      sourceCommit: SOURCE_COMMIT,
      sourceRef: SOURCE_REF,
    }), /unico installer/);
  } finally {
    await fsp.rm(ambiguous.root, { recursive: true, force: true });
  }

  const mismatch = await createDistFixture();
  try {
    await assert.rejects(() => prepareWindowsReleaseBundle({
      appDir: mismatch.appDir,
      distDir: mismatch.distDir,
      bundleDir: path.join(mismatch.appDir, "release-bundle"),
      version: "0.3.0",
      sourceCommit: SOURCE_COMMIT,
      sourceRef: SOURCE_REF,
    }), /latest.yml declara 0.2.0/);
  } finally {
    await fsp.rm(mismatch.root, { recursive: true, force: true });
  }
});
