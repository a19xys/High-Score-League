"use strict";

// Explicit local-library QA; intentionally outside the default node --test scan.

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  verifyCompetitionManifest,
  writeCompetitionManifest,
} = require("../../src/competition-manifest");
const { loadPackFromDir } = require("../../src/pack");

async function loadedPack(packRoot) {
  const loaded = loadPackFromDir(packRoot);
  assert.equal(loaded.loaded, true);
  assert.deepEqual(loaded.errors, []);
  return loaded.pack;
}

async function expectBlocked(packRoot, expectedCode) {
  const pack = await loadedPack(packRoot);
  await assert.rejects(
    () => verifyCompetitionManifest(pack),
    (error) => error?.code === expectedCode,
  );
  return "blocked";
}

async function scenario(tempRoot, sourceRoot, name, sabotage) {
  const packRoot = path.join(tempRoot, name);
  await fsp.cp(sourceRoot, packRoot, { recursive: true, errorOnExist: true });
  await sabotage(packRoot);
  return packRoot;
}

async function main() {
  const sourceRoot = path.resolve(process.argv[2] || "D:/High Score League/Space Invaders");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-space-invaders-manifest-qa-"));
  try {
    const original = await verifyCompetitionManifest(await loadedPack(sourceRoot));
    const report = {
      sourceRoot,
      tempRoot,
      originalManifestSha256: original.manifestSha256,
      romMutated: false,
      scenarios: {},
    };

    let packRoot = await scenario(tempRoot, sourceRoot, "pack-json-byte", async (root) => {
      await fsp.appendFile(path.join(root, "pack.json"), " ");
    });
    report.scenarios.packJsonByte = await expectBlocked(packRoot, "size_mismatch");

    packRoot = await scenario(tempRoot, sourceRoot, "adapter-byte", async (root) => {
      await fsp.appendFile(path.join(root, "scripts", "invaders.lua"), " ");
    });
    report.scenarios.adapterByte = await expectBlocked(packRoot, "size_mismatch");

    packRoot = await scenario(tempRoot, sourceRoot, "extra-script", async (root) => {
      await fsp.writeFile(path.join(root, "scripts", "qa-extra.lua"), "return {}\n");
    });
    report.scenarios.extraRelevantFile = await expectBlocked(packRoot, "coverage_mismatch");

    packRoot = await scenario(tempRoot, sourceRoot, "manifest-byte", async (root) => {
      const manifestPath = path.join(root, "competition-manifest.json");
      const bytes = await fsp.readFile(manifestPath);
      await fsp.writeFile(manifestPath, bytes.subarray(0, bytes.length - 1));
    });
    report.scenarios.manifestByte = await expectBlocked(packRoot, "noncanonical_manifest");

    packRoot = await scenario(tempRoot, sourceRoot, "regenerated", async (root) => {
      await fsp.appendFile(path.join(root, "scripts", "invaders.lua"), " -- manifest regeneration QA\n");
    });
    await expectBlocked(packRoot, "size_mismatch");
    const regeneratedPack = await loadedPack(packRoot);
    const regenerated = await writeCompetitionManifest(regeneratedPack);
    const reverified = await verifyCompetitionManifest(regeneratedPack);
    assert.notEqual(reverified.manifestSha256, original.manifestSha256);
    assert.equal(reverified.manifestSha256, regenerated.manifestSha256);
    report.scenarios.regenerated = "accepted-with-new-hash";
    report.regeneratedManifestSha256 = regenerated.manifestSha256;

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
