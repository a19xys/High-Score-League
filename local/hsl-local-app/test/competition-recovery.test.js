const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { reconcileCompetitionRuns } = require("../src/competition-run-finalizer");
const { armRunInputMonitor, canonicalJsonBytes, sha256Bytes } = require("../src/run-input-integrity");
const { writeCompetitionAppCloseSeal } = require("../src/competition-close-seal");
const { OUTPUT_MONITOR_ARMED_FILENAME } = require("../src/competition-output-monitor");
const {
  authorityPathFor,
  establishProtectedScopeAuthority,
} = require("../src/competition-scope-authority");

async function workspace(t) {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-run-recovery-"));
  t.after(() => fsp.rm(userDataDir, { recursive: true, force: true }));
  return userDataDir;
}

async function preparedRun(userDataDir, runId) {
  const runRoot = path.join(userDataDir, "runtime", "runs", runId);
  const integrityDir = path.join(runRoot, "integrity");
  const scopedQueueRoot = path.join(userDataDir, "players", "user", "packs", "pack");
  const manifestBytes = canonicalJsonBytes({ version: 1, runId, fixture: true });
  await fsp.mkdir(integrityDir, { recursive: true });
  await fsp.writeFile(path.join(runRoot, "run-input-manifest.json"), manifestBytes);
  await fsp.writeFile(path.join(runRoot, "prepared.marker"), canonicalJsonBytes({
    version: 1, runId, runInputManifestSha256: sha256Bytes(manifestBytes), preparedAt: "2026-08-21T10:00:00.000Z",
  }));
  await fsp.writeFile(path.join(integrityDir, "recovery.json"), canonicalJsonBytes({
    version: 1,
    runId,
    createdAt: "2026-08-21T10:00:00.000Z",
    packId: "space-invaders-s1-w1-r2",
    weekId: "week-1",
    playerBinding: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    mameVersion: "0.287",
    pluginVersion: "0.4.0",
    captureClientVersion: "0.3.0",
    dips: [],
    provenance: { artifactSha256: "c".repeat(64), artifactSizeBytes: 100, competitionManifestSha256: "b".repeat(64), mode: "remote_verified" },
    rom: "invaders",
    gameId: "space-invaders",
    automaticCaptureStrategy: "invaders-game-mode-final-v1",
    scopedQueueRoot,
  }));
  await establishProtectedScopeAuthority({ scopedQueueRoot }, {
    playerKey: "user",
    packKey: "pack",
    packId: "space-invaders-s1-w1-r2",
    weekId: "week-1",
  }, { establishedAt: "2026-08-21T09:59:00.000Z" });
  return {
    integrityDir,
    runId,
    runRoot,
    scopedQueueRoot,
    candidateLedgerPath: path.join(integrityDir, "candidate-set.log"),
    stagingCandidatesDir: path.join(runRoot, "events", "candidates"),
    stagingCommitmentsDir: path.join(runRoot, "events", "commitments"),
    runInputManifestSha256: sha256Bytes(manifestBytes),
  };
}

async function installCloseSeal(run, options = {}) {
  await Promise.all([
    fsp.mkdir(path.join(run.integrityDir, "app"), { recursive: true }),
    fsp.mkdir(run.stagingCandidatesDir, { recursive: true }),
    fsp.mkdir(run.stagingCommitmentsDir, { recursive: true }),
  ]);
  await fsp.writeFile(path.join(run.integrityDir, "final.marker"), canonicalJsonBytes({ fixture: true }));
  await fsp.writeFile(run.candidateLedgerPath, "", "utf8");
  await fsp.writeFile(path.join(run.integrityDir, "mame-exit.json"), canonicalJsonBytes({
    version: 1, runId: run.runId, exitCode: 0, observedAt: "2026-08-21T10:29:00.000Z",
  }));
  const runInputState = await armRunInputMonitor(run, { nowIso: "2026-08-21T10:00:00.000Z" });
  await fsp.writeFile(path.join(run.integrityDir, "app", OUTPUT_MONITOR_ARMED_FILENAME), canonicalJsonBytes({
    version: 1, runId: run.runId, armedAt: "2026-08-21T10:00:00.000Z",
  }));
  await writeCompetitionAppCloseSeal(run, {
    exitCode: 0,
    runInputState,
    outputState: { version: 1, runId: run.runId, candidates: [], commitments: [], violations: [] },
  }, { nowIso: "2026-08-21T10:30:00.000Z" });
  if (options.corrupt) await fsp.writeFile(path.join(run.integrityDir, "app", "app-close-seal.json"), "{bad", "utf8");
}

async function installEmptyPlan(run, options = {}) {
  const receipt = canonicalJsonBytes({ version: 1, runId: run.runId, status: "clean", outputs: [] });
  const stagingDir = path.join(run.integrityDir, "finalization-staging");
  await fsp.mkdir(stagingDir, { recursive: true });
  await fsp.writeFile(path.join(stagingDir, "receipt.json"), receipt);
  const plan = {
    version: 1,
    runId: run.runId,
    status: "clean",
    violations: [],
    failClosedReason: null,
    receipt: { filename: `${run.runId}.json`, sha256: sha256Bytes(receipt), stagedFile: "receipt.json" },
    outputs: [],
    finalizedAt: "2026-08-21T10:30:00.000Z",
  };
  const planBytes = canonicalJsonBytes(plan);
  await fsp.writeFile(path.join(run.integrityDir, "finalization-plan.json"), planBytes);
  if (options.commit) {
    const receiptPath = path.join(run.scopedQueueRoot, "competition", "finalized", `${run.runId}.json`);
    await fsp.mkdir(path.dirname(receiptPath), { recursive: true });
    await fsp.writeFile(receiptPath, options.corruptReceipt ? Buffer.from("corrupt") : receipt);
    await fsp.writeFile(path.join(run.integrityDir, "finalization.json"), canonicalJsonBytes({
      version: 1,
      runId: run.runId,
      status: "clean",
      planSha256: sha256Bytes(planBytes),
      receiptSha256: sha256Bytes(receipt),
      outputs: [],
      finalizedAt: plan.finalizedAt,
      committedAt: plan.finalizedAt,
    }));
  }
}

test("startup removes only dead PREPARING orphans", async (t) => {
  const userDataDir = await workspace(t);
  const runRoot = path.join(userDataDir, "runtime", "runs", "run_orphan");
  await fsp.mkdir(runRoot, { recursive: true });
  await fsp.writeFile(path.join(runRoot, "preparing.marker"), canonicalJsonBytes({
    version: 1, runId: "run_orphan", pid: 2147483647, createdAt: "2026-08-21T10:00:00.000Z",
  }));
  const results = await reconcileCompetitionRuns({ userDataDir });
  assert.equal(results[0].status, "orphan_preparing_removed");
  await assert.rejects(() => fsp.access(runRoot));
});

test("prepared runs without final seal or exit record are classified fail-closed", async (t) => {
  const userDataDir = await workspace(t);
  const noSeal = await preparedRun(userDataDir, "run_no_seal");
  const noExit = await preparedRun(userDataDir, "run_no_exit");
  await fsp.writeFile(path.join(noExit.integrityDir, "final.marker"), "{}\n");
  const results = await reconcileCompetitionRuns({ userDataDir }, { nowIso: "2026-08-21T11:00:00.000Z" });
  assert.deepEqual(results.map((item) => [item.runId, item.status, item.reason]), [
    [noExit.runId, "fail_closed", "missing_mame_exit"],
    [noSeal.runId, "fail_closed", "missing_final_seal"],
  ]);
});

test("final marker plus mame exit without app close seal is fail-closed", async (t) => {
  const userDataDir = await workspace(t);
  const run = await preparedRun(userDataDir, "run_missing_close_seal");
  await fsp.writeFile(path.join(run.integrityDir, "final.marker"), "{}\n");
  await fsp.writeFile(path.join(run.integrityDir, "mame-exit.json"), "{}\n");
  const results = await reconcileCompetitionRuns({ userDataDir });
  assert.equal(results[0].status, "fail_closed");
  assert.equal(results[0].reason, "missing_app_close_seal");
});

test("recovery refuses a sealed Protected run when scope authority disappeared", async (t) => {
  const userDataDir = await workspace(t);
  const run = await preparedRun(userDataDir, "run_missing_scope_authority");
  await installCloseSeal(run);
  await installEmptyPlan(run);
  await fsp.rm(authorityPathFor({ scopedQueueRoot: run.scopedQueueRoot }));
  const results = await reconcileCompetitionRuns({ userDataDir }, { compact: false });
  assert.equal(results[0].status, "fail_closed");
  assert.equal(results[0].reason, "missing_scope_authority");
  await assert.rejects(() => fsp.access(path.join(run.scopedQueueRoot, "competition", "finalized", `${run.runId}.json`)));
});

test("startup resumes a sealed journal and commits exactly once", async (t) => {
  const userDataDir = await workspace(t);
  const run = await preparedRun(userDataDir, "run_resume");
  await installCloseSeal(run);
  await installEmptyPlan(run);
  const first = await reconcileCompetitionRuns({ userDataDir }, { compact: false });
  assert.equal(first[0].status, "clean");
  await fsp.access(path.join(run.integrityDir, "finalization.json"));
  const second = await reconcileCompetitionRuns({ userDataDir }, { compact: false });
  assert.equal(second[0].status, "clean");
  assert.equal(second[0].recovered, false);
});

test("corrupt app close seal never promotes a partial journal", async (t) => {
  const userDataDir = await workspace(t);
  const run = await preparedRun(userDataDir, "run_corrupt_close_seal");
  await installCloseSeal(run, { corrupt: true });
  await installEmptyPlan(run);
  const results = await reconcileCompetitionRuns({ userDataDir }, { compact: false });
  assert.equal(results[0].status, "fail_closed");
  assert.match(results[0].reason, /JSON|app-close-seal|Unexpected|SyntaxError/i);
});

test("corrupt receipt after commit is classified deterministically fail-closed", async (t) => {
  const userDataDir = await workspace(t);
  const run = await preparedRun(userDataDir, "run_corrupt_receipt");
  await installEmptyPlan(run, { commit: true, corruptReceipt: true });
  const results = await reconcileCompetitionRuns({ userDataDir }, { compact: false, nowIso: "2026-08-21T11:00:00.000Z" });
  assert.equal(results[0].status, "fail_closed");
  assert.equal(results[0].reason, "finalized_receipt_changed");
});
