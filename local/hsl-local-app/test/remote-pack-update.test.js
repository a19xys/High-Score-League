const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setPackDirectory, getDirectoryKey } = require("../src/pack-directory");
const { loadPackFromDir } = require("../src/pack");
const { writeCompetitionManifest, verifyCompetitionManifest } = require("../src/competition-manifest");
const { readPackProvenanceReceipt, writePackProvenanceReceipt } = require("../src/pack-provenance");
const { resolveScopedQueue } = require("../src/scoped-queue");
const {
  UPDATE_BACKUP_PREFIX,
  UPDATE_STAGING_PREFIX,
  executeRemotePackUpdate,
  recoverOnePackUpdate,
  recoverPackUpdates,
  validateJournal,
} = require("../src/remote-pack-update");

const OLD_PACK_ID = "pack-old-opaque";
const TARGET_PACK_ID = "pack-target-opaque";
const WEEK_ID = "week-family";
const GAME_ID = "game-family";
const TRANSACTION_ID = "0123456789abcdef01234567";
const CREATED_AT = "2026-08-24T10:00:00.000Z";
const ARTIFACT_SHA256 = "a".repeat(64);
const ARTIFACT_SIZE = 10;

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-update-"));
  try { return await run(root); }
  finally { await fsp.rm(root, { recursive: true, force: true }); }
}

async function writeManagedPack(packDir, packId, overrides = {}) {
  await fsp.mkdir(path.join(packDir, "roms"), { recursive: true });
  await fsp.mkdir(path.join(packDir, "scripts"), { recursive: true });
  await fsp.writeFile(path.join(packDir, "roms", "game.zip"), `rom:${packId}`);
  await fsp.writeFile(path.join(packDir, "scripts", "capture.lua"), `return '${packId}'`);
  const value = {
    packVersion: 2,
    packId,
    gameId: GAME_ID,
    rom: "game",
    seasonId: "season-family",
    seasonSlug: "season-family",
    seasonName: "Season",
    weekId: WEEK_ID,
    weekNumber: 1,
    webBaseUrl: "https://highscoreleague.com",
    runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
    mame: {
      romPath: "roms",
      launchArgs: [],
      profiles: {
        practice: { launchArgs: [] },
        competition: { launchArgs: [], integrity: { version: 1, mameVersion: "0.287", dips: [] } },
      },
    },
    capture: {
      mode: "plugin",
      pluginName: "hsl-score",
      adapter: "scripts/capture.lua",
      automatic: { version: 1, strategy: "fixture-v1" },
    },
    ...overrides,
  };
  await fsp.writeFile(path.join(packDir, "pack.json"), `${JSON.stringify(value, null, 2)}\n`);
  const loaded = loadPackFromDir(packDir);
  assert.equal(loaded.loaded, true);
  assert.deepEqual(loaded.errors, []);
  await writeCompetitionManifest(loaded.pack);
  return loadPackFromDir(packDir).pack;
}

async function setup(root) {
  const config = { userDataDir: path.join(root, "userData") };
  const library = path.join(root, "library");
  const finalDir = path.join(library, "Installed Game");
  const targetSource = path.join(root, "target-source");
  await fsp.mkdir(library, { recursive: true });
  await setPackDirectory(config, library);
  const oldPack = await writeManagedPack(finalDir, OLD_PACK_ID);
  const targetPack = await writeManagedPack(targetSource, TARGET_PACK_ID);
  const targetManifest = await verifyCompetitionManifest(targetPack);
  return { config, finalDir, library, oldPack, targetManifest, targetPack, targetSource };
}

function updateOptions(state, overrides = {}) {
  return {
    cleanupDownloadedArtifactImpl: async () => {},
    config: state.config,
    createTransactionId: () => TRANSACTION_ID,
    downloadPackArtifactImpl: async () => ({ bytes: ARTIFACT_SIZE, filePath: path.join(path.dirname(state.library), "artifact.zip"), tempDir: null }),
    ensureFreshCapability: async () => ({ ok: true, capability: { publishedPackId: TARGET_PACK_ID } }),
    isOperationBlocked: async () => false,
    oldPack: {
      gameId: GAME_ID,
      packDir: state.finalDir,
      packId: OLD_PACK_ID,
      weekId: WEEK_ID,
    },
    requestPackDescriptorImpl: async () => ({
      status: "ready",
      descriptor: { artifact: { sha256: ARTIFACT_SHA256, sizeBytes: ARTIFACT_SIZE }, packId: TARGET_PACK_ID, version: 1 },
    }),
    stagePackZipForUpdateImpl: async (_zipPath, stagingDir) => {
      await fsp.cp(state.targetSource, stagingDir, { recursive: true, errorOnExist: true, force: false });
      const pack = loadPackFromDir(stagingDir).pack;
      return { manifest: await verifyCompetitionManifest(pack), pack, warnings: [] };
    },
    targetPackId: TARGET_PACK_ID,
    ...overrides,
  };
}

async function packIdAt(packDir) {
  return loadPackFromDir(packDir).pack?.packId || null;
}

test("update remoto conserva packDir, instala sólo target y crea provenance propia", async () => {
  await withTempDir(async (root) => {
    const state = await setup(root);
    const session = { hasSession: true, userId: "player-1" };
    const scopeConfig = (packId) => ({
      ...state.config,
      pack: { gameId: GAME_ID, packId, packRoot: state.finalDir, rom: "game", webBaseUrl: "https://highscoreleague.com", weekId: WEEK_ID },
    });
    const oldScope = resolveScopedQueue(scopeConfig(OLD_PACK_ID), session);
    const targetScope = resolveScopedQueue(scopeConfig(TARGET_PACK_ID), session);
    const pendingPath = path.join(oldScope.scopedPendingDir, "pending-old.json");
    const pendingBytes = Buffer.from('{"packId":"pack-old-opaque","score":123}\n');
    await fsp.mkdir(oldScope.scopedPendingDir, { recursive: true });
    await fsp.writeFile(pendingPath, pendingBytes);
    const phases = [];
    let bookkeeping = 0;
    const result = await executeRemotePackUpdate(updateOptions(state, {
      nowIso: CREATED_AT,
      onBookkeeping: async () => { bookkeeping += 1; },
      onPhase: (phase) => phases.push(phase),
    }));
    assert.equal(result.status, "updated");
    assert.equal(result.packDir, state.finalDir);
    assert.equal(await packIdAt(state.finalDir), TARGET_PACK_ID);
    assert.equal(bookkeeping, 1);
    assert.deepEqual(phases, [
      "Preparando actualización…",
      "Descargando actualización…",
      "Verificando actualización…",
      "Instalando actualización…",
    ]);
    const visible = (await fsp.readdir(state.library)).filter((name) => !name.startsWith(".hsl-"));
    assert.deepEqual(visible, ["Installed Game"]);
    assert.equal((await fsp.readdir(state.library)).some((name) => name.startsWith(".hsl-")), false);
    const receipt = readPackProvenanceReceipt(state.config, TARGET_PACK_ID, {
      artifactSha256: ARTIFACT_SHA256,
      artifactSizeBytes: ARTIFACT_SIZE,
      competitionManifestSha256: state.targetManifest.manifestSha256,
    });
    assert.equal(receipt.ok, true);
    assert.equal(readPackProvenanceReceipt(state.config, OLD_PACK_ID).ok, false);
    assert.notEqual(oldScope.packKey, targetScope.packKey);
    assert.deepEqual(await fsp.readFile(pendingPath), pendingBytes);
    await assert.rejects(fsp.stat(targetScope.scopedQueueRoot), /ENOENT/);
  });
});

test("rechazos antes del commit preservan old y no crean provenance target", async (t) => {
  const cases = [
    {
      name: "family-week",
      prepare: async (state) => {
        await fsp.rm(state.targetSource, { recursive: true, force: true });
        await writeManagedPack(state.targetSource, TARGET_PACK_ID, { weekId: "other-week" });
      },
      expected: "revision-conflict",
    },
    {
      name: "family-game",
      prepare: async (state) => {
        await fsp.rm(state.targetSource, { recursive: true, force: true });
        await writeManagedPack(state.targetSource, TARGET_PACK_ID, { gameId: "other-game" });
      },
      expected: "revision-conflict",
    },
    {
      name: "authority-race",
      overrides: { ensureFreshCapability: async () => ({ ok: true, capability: { publishedPackId: "newer-opaque-target" } }) },
      expected: "target-not-current",
    },
    {
      name: "mame-busy",
      overrides: { isOperationBlocked: async () => true },
      expected: "operation-busy",
    },
    {
      name: "old-mutated",
      overridesForState: (state) => ({
        stagePackZipForUpdateImpl: async (_zipPath, stagingDir) => {
          await fsp.cp(state.targetSource, stagingDir, { recursive: true });
          await fsp.writeFile(path.join(state.finalDir, "roms", "game.zip"), "changed-during-download");
          const pack = loadPackFromDir(stagingDir).pack;
          return { manifest: await verifyCompetitionManifest(pack), pack, warnings: [] };
        },
      }),
      expected: "revision-conflict",
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => withTempDir(async (root) => {
      const state = await setup(root);
      await fixture.prepare?.(state);
      const overrides = { ...(fixture.overrides || {}), ...(fixture.overridesForState?.(state) || {}) };
      const result = await executeRemotePackUpdate(updateOptions(state, overrides));
      assert.equal(result.status, fixture.expected);
      assert.equal(await packIdAt(state.finalDir), OLD_PACK_ID);
      assert.equal(readPackProvenanceReceipt(state.config, TARGET_PACK_ID).ok, false);
      assert.equal((await fsp.readdir(state.library)).some((name) => name.startsWith(".hsl-update-")), false);
    }));
  }
});

function recoveryJournal(state, phase, overrides = {}) {
  return {
    artifactSha256: ARTIFACT_SHA256,
    artifactSizeBytes: ARTIFACT_SIZE,
    backupBasename: `${UPDATE_BACKUP_PREFIX}${TRANSACTION_ID}`,
    createdAt: CREATED_AT,
    gameId: GAME_ID,
    libraryKey: getDirectoryKey(state.library),
    manifestSha256: state.targetManifest.manifestSha256,
    oldPackId: OLD_PACK_ID,
    packBasename: path.basename(state.finalDir),
    phase,
    provenanceCreated: false,
    schemaVersion: 1,
    stagingBasename: `${UPDATE_STAGING_PREFIX}${TRANSACTION_ID}`,
    targetPackId: TARGET_PACK_ID,
    targetReceiptPreexisting: false,
    transactionId: TRANSACTION_ID,
    updatedAt: CREATED_AT,
    weekId: WEEK_ID,
    ...overrides,
  };
}

async function moveOldToBackup(state) {
  await fsp.rename(state.finalDir, path.join(state.library, `${UPDATE_BACKUP_PREFIX}${TRANSACTION_ID}`));
}

async function copyTarget(state, destination) {
  await fsp.cp(state.targetSource, destination, { recursive: true, errorOnExist: true, force: false });
}

test("recovery restaura old antes del core commit y converge target después", async (t) => {
  await t.test("before-rename", async () => withTempDir(async (root) => {
    const state = await setup(root);
    await copyTarget(state, path.join(state.library, `${UPDATE_STAGING_PREFIX}${TRANSACTION_ID}`));
    const result = await recoverOnePackUpdate(state.config, recoveryJournal(state, "prepared"));
    assert.equal(result.status, "old-preserved");
    assert.equal(await packIdAt(state.finalDir), OLD_PACK_ID);
  }));

  await t.test("after-old-backup", async () => withTempDir(async (root) => {
    const state = await setup(root);
    await moveOldToBackup(state);
    await copyTarget(state, path.join(state.library, `${UPDATE_STAGING_PREFIX}${TRANSACTION_ID}`));
    const result = await recoverOnePackUpdate(state.config, recoveryJournal(state, "old-backed-up"));
    assert.equal(result.status, "old-restored");
    assert.equal(await packIdAt(state.finalDir), OLD_PACK_ID);
  }));

  for (const withReceipt of [false, true]) {
    await t.test(withReceipt ? "after-provenance-before-core" : "after-target-final", async () => withTempDir(async (root) => {
      const state = await setup(root);
      await moveOldToBackup(state);
      await copyTarget(state, state.finalDir);
      if (withReceipt) {
        await writePackProvenanceReceipt(state.config, {
          artifactSha256: ARTIFACT_SHA256,
          artifactSizeBytes: ARTIFACT_SIZE,
          competitionManifestSha256: state.targetManifest.manifestSha256,
          importedAt: CREATED_AT,
          packId: TARGET_PACK_ID,
        });
      }
      const result = await recoverOnePackUpdate(state.config, recoveryJournal(
        state,
        withReceipt ? "provenance-written" : "target-installed",
        { provenanceCreated: withReceipt },
      ));
      assert.equal(result.status, "target-rolled-back");
      assert.equal(await packIdAt(state.finalDir), OLD_PACK_ID);
      assert.equal(readPackProvenanceReceipt(state.config, TARGET_PACK_ID).ok, false);
    }));
  }

  await t.test("after-core-commit", async () => withTempDir(async (root) => {
    const state = await setup(root);
    await moveOldToBackup(state);
    await copyTarget(state, state.finalDir);
    await writePackProvenanceReceipt(state.config, {
      artifactSha256: ARTIFACT_SHA256,
      artifactSizeBytes: ARTIFACT_SIZE,
      competitionManifestSha256: state.targetManifest.manifestSha256,
      importedAt: CREATED_AT,
      packId: TARGET_PACK_ID,
    });
    let bookkeeping = 0;
    const result = await recoverOnePackUpdate(state.config, recoveryJournal(state, "core-committed", {
      provenanceCreated: true,
    }), { onBookkeeping: async () => { bookkeeping += 1; } });
    assert.equal(result.status, "target-converged");
    assert.equal(await packIdAt(state.finalDir), TARGET_PACK_ID);
    assert.equal(bookkeeping, 1);
    assert.equal((await fsp.readdir(state.library)).some((name) => name.startsWith(UPDATE_BACKUP_PREFIX)), false);
  }));
});

test("fallo post-commit deja journal y startup completa bookkeeping idempotente", async () => {
  await withTempDir(async (root) => {
    const state = await setup(root);
    let attempts = 0;
    const first = await executeRemotePackUpdate(updateOptions(state, {
      nowIso: CREATED_AT,
      onBookkeeping: async () => {
        attempts += 1;
        throw new Error("simulated-bookkeeping-interruption");
      },
    }));
    assert.equal(first.status, "updated");
    assert.equal(first.journal.phase, "post-commit-pending");
    assert.equal(await packIdAt(state.finalDir), TARGET_PACK_ID);
    assert.ok((await fsp.readdir(state.library)).some((name) => name.startsWith(UPDATE_BACKUP_PREFIX)));

    const recovered = await recoverPackUpdates(state.config, {
      onBookkeeping: async () => { attempts += 1; },
    });
    assert.deepEqual(recovered.map((item) => item.status), ["target-converged"]);
    assert.equal(attempts, 2);
    assert.equal(await packIdAt(state.finalDir), TARGET_PACK_ID);
    assert.equal((await fsp.readdir(state.library)).some((name) => name.startsWith(UPDATE_BACKUP_PREFIX)), false);
  });
});

test("journal hostil/corrupto no se convierte en rename o rm externo", async () => {
  await withTempDir(async (root) => {
    const state = await setup(root);
    const external = path.join(root, "external-marker");
    await fsp.writeFile(external, "keep");
    for (const mutation of [
      { packBasename: "../external-marker" },
      { packBasename: path.resolve(external) },
      { stagingBasename: `${UPDATE_STAGING_PREFIX}other` },
      { backupBasename: "backup-without-required-prefix" },
    ]) {
      assert.equal(validateJournal(recoveryJournal(state, "prepared", mutation)), null);
    }
    const mismatch = await recoverOnePackUpdate(state.config, recoveryJournal(state, "prepared", { libraryKey: "other-library" }));
    assert.equal(mismatch.status, "library-mismatch");
    assert.equal(await fsp.readFile(external, "utf8"), "keep");

    const journalDir = path.join(state.config.userDataDir, "pack-updates");
    await fsp.mkdir(journalDir, { recursive: true });
    await fsp.writeFile(path.join(journalDir, `${TRANSACTION_ID}.json`), "{broken");
    assert.deepEqual((await recoverPackUpdates(state.config)).map((item) => item.status), ["invalid-journal"]);
    assert.equal(await fsp.readFile(external, "utf8"), "keep");
    assert.equal(await packIdAt(state.finalDir), OLD_PACK_ID);
  });
});
