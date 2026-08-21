const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  readPackProvenanceReceipt,
  validatePackProvenanceReceipt,
  writePackProvenanceReceipt,
} = require("../src/pack-provenance");
const { persistRemoteImportProvenance } = require("../src/remote-pack-import");

const PACK_ID = "space-invaders-s1-w1-r1";
const ARTIFACT_SHA = "a".repeat(64);
const MANIFEST_SHA = "b".repeat(64);

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-provenance-"));
  try { return await fn(dir); }
  finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

test("remote provenance receipt is atomic, closed and bound to pack plus manifest", async () => {
  await withTempDir(async (userDataDir) => {
    const config = { userDataDir };
    const written = await writePackProvenanceReceipt(config, {
      artifactSha256: ARTIFACT_SHA,
      artifactSizeBytes: 1234,
      competitionManifestSha256: MANIFEST_SHA,
      importedAt: "2026-08-21T10:00:00.000Z",
      packId: PACK_ID,
    });
    assert.equal(written.receipt.version, 1);
    assert.equal(written.receiptPath.includes(PACK_ID), false);
    assert.equal(readPackProvenanceReceipt(config, PACK_ID, {
      competitionManifestSha256: MANIFEST_SHA,
    }).ok, true);
    const changedManifest = readPackProvenanceReceipt(config, PACK_ID, {
      competitionManifestSha256: "c".repeat(64),
    });
    assert.equal(changedManifest.ok, false);
    assert.match(changedManifest.errors.join(" "), /competitionManifestSha256/);
  });
});

test("receipt rejects malformed, wrong-pack and schema-extended values", () => {
  const valid = {
    version: 1,
    packId: PACK_ID,
    artifactSha256: ARTIFACT_SHA,
    artifactSizeBytes: 1234,
    competitionManifestSha256: MANIFEST_SHA,
    importedAt: "2026-08-21T10:00:00.000Z",
  };
  assert.deepEqual(validatePackProvenanceReceipt(valid, { packId: PACK_ID }).errors, []);
  for (const mutation of [
    { ...valid, packId: "other" },
    { ...valid, artifactSha256: "broken" },
    { ...valid, trusted: true },
  ]) {
    assert.ok(validatePackProvenanceReceipt(mutation, { packId: PACK_ID }).errors.length > 0);
  }
});

test("verified remote install persists receipt; already-installed never grants it", async () => {
  const writes = [];
  const options = {
    config: { userDataDir: "fixture" },
    loadPackFromDirImpl: () => ({ loaded: true, errors: [], pack: { packId: PACK_ID } }),
    verifyCompetitionManifestImpl: async () => ({ manifestSha256: MANIFEST_SHA }),
    writePackProvenanceReceiptImpl: async (_config, value) => {
      writes.push(value);
      return { receipt: value, receiptPath: "receipt.json" };
    },
  };
  const descriptor = { packId: PACK_ID, artifact: { sha256: ARTIFACT_SHA, sizeBytes: 1234 } };
  const installed = await persistRemoteImportProvenance(
    options,
    descriptor,
    { bytes: 1234 },
    { ok: true, imported: true, alreadyInstalled: false, packDir: "installed-pack" },
  );
  assert.equal(installed.receipt.artifactSha256, ARTIFACT_SHA);
  assert.equal(writes.length, 1);

  const existing = await persistRemoteImportProvenance(
    options,
    descriptor,
    { bytes: 1234 },
    { ok: true, imported: false, alreadyInstalled: true, packDir: "installed-pack" },
  );
  assert.equal(existing, null);
  assert.equal(writes.length, 1);
});

test("manual importer modules do not own or create productive provenance", async () => {
  const [importer, service] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "src", "pack-importer.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
  ]);
  assert.doesNotMatch(importer, /writePackProvenanceReceipt/);
  assert.doesNotMatch(service.match(/async function importPackFromZipForGui[\s\S]*?\n}/)?.[0] || "", /Provenance|receipt/);
  assert.doesNotMatch(service.match(/async function importPackFromFolderForGui[\s\S]*?\n}/)?.[0] || "", /Provenance|receipt/);
});
