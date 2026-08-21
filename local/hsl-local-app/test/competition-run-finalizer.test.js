const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { finalizeCompetitionRun } = require("../src/competition-run-finalizer");
const { validateEvent } = require("../src/event-validation");

const MANIFEST_SHA = "a".repeat(64);

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function fixture(t, options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-finalizer-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const runId = options.runId || "run_finalizer_test";
  const integrityDir = path.join(root, "run", "integrity");
  const stagingCandidatesDir = path.join(root, "run", "events", "candidates");
  const scopedPendingDir = path.join(root, "queue", "pending");
  const scopedRejectedDir = path.join(root, "queue", "rejected");
  const integrity = {
    version: 1,
    guardVersion: 1,
    runId,
    packId: "space-invaders-s1-w1-r1",
    manifestSha256: MANIFEST_SHA,
    mameVersion: "0.287",
    observedMameVersion: "0.287",
    pluginVersion: "0.3.0",
    dips: options.dips || [],
    provenance: {
      artifactSha256: null,
      artifactSizeBytes: null,
      competitionManifestSha256: MANIFEST_SHA,
      mode: "developer_override",
    },
  };
  const run = {
    runId,
    integrity,
    integrityDir,
    stagingCandidatesDir,
    automaticCaptureStrategy: "invaders-game-mode-final-v1",
    provenance: integrity.provenance,
    config: { pack: { gameId: "space-invaders", rom: "invaders" } },
  };
  const scope = { scopedPendingDir, scopedRejectedDir };
  await Promise.all([
    fsp.mkdir(integrityDir, { recursive: true }),
    fsp.mkdir(stagingCandidatesDir, { recursive: true }),
    fsp.mkdir(scopedPendingDir, { recursive: true }),
    fsp.mkdir(scopedRejectedDir, { recursive: true }),
  ]);
  await writeJson(path.join(integrityDir, "identity.json"), {
    version: 1,
    runId,
    packId: integrity.packId,
    manifestSha256: integrity.manifestSha256,
    mameVersion: integrity.mameVersion,
    pluginVersion: integrity.pluginVersion,
  });
  await writeJson(path.join(integrityDir, "armed.marker"), { version: 1, runId });
  return { integrityDir, root, run, scope, stagingCandidatesDir };
}

async function seal(run, violations = []) {
  for (const code of violations) {
    await writeJson(path.join(run.integrityDir, `violation.${code}.marker`), {
      version: 1, runId: run.runId, code,
    });
  }
  await writeJson(path.join(run.integrityDir, "final.marker"), {
    version: 1,
    runId: run.runId,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    exitPending: true,
  });
  await writeJson(path.join(run.integrityDir, "state.json"), {
    version: 1,
    runId: run.runId,
    packId: run.integrity.packId,
    phase: violations.length > 0 ? "violated" : "armed",
    armed: true,
    stopObserved: true,
    violations,
  });
}

async function candidate(run, sequence, score) {
  const value = {
    version: 1,
    candidateId: `${run.runId}_candidate_${String(sequence).padStart(6, "0")}`,
    runId: run.runId,
    rom: "invaders",
    score,
    detectedAt: `2026-08-21T10:00:${String(sequence).padStart(2, "0")}.000Z`,
    source: "mame_memory",
    mameVersion: "0.287",
    pluginVersion: "0.3.0",
    strategy: run.automaticCaptureStrategy,
    metadata: {
      gameOverDetected: true,
      displayScore: score,
      trackedScore: score,
      rollovers: 0,
    },
  };
  await writeJson(path.join(run.stagingCandidatesDir, `candidate-${sequence}.json`), value);
  return value;
}

async function jsonFiles(directory) {
  return (await fsp.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
}

test("candidates remain private until a clean post-process seal promotes every attempt", async (t) => {
  const { run, scope } = await fixture(t);
  await candidate(run, 1, 120);
  await candidate(run, 2, 340);
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
  await seal(run);

  const result = await finalizeCompetitionRun(run, scope, { exitCode: 0 });
  assert.equal(result.status, "clean");
  assert.equal(result.adopted.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal((await jsonFiles(scope.scopedPendingDir)).length, 2);
  for (const adopted of result.adopted) {
    const event = JSON.parse(await fsp.readFile(adopted.finalPath, "utf8"));
    assert.equal(event.detection.manualConfirm, false);
    assert.equal(event.competitionIntegrity.event.score, event.score);
    assert.equal(event.competitionIntegrity.provenance.mode, "developer_override");
    assert.deepEqual(validateEvent(event, { competitionGuard: run.integrity }).errors, []);
  }
});

for (const violation of [
  "pause", "state_save", "state_load", "dip_changed", "machine_reset",
  "menu_opened", "speed_changed", "throttle_changed",
]) {
  test(`candidate + ${violation} is rejected after close`, async (t) => {
    const { run, scope } = await fixture(t, {
      dips: violation === "dip_changed" ? [{ portTag: ":IN2", mask: 3, value: 0 }] : [],
    });
    await candidate(run, 1, 250);
    await seal(run, [violation]);
    const result = await finalizeCompetitionRun(run, scope, { exitCode: 0 });
    assert.equal(result.status, "violated");
    assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
    assert.equal(result.rejected.length, 1);
    assert.match(await fsp.readFile(result.rejected[0].notePath, "utf8"), new RegExp(`LOCAL_COMPETITION_INTEGRITY[\\s\\S]*${violation}`));
  });
}

test("a sticky violation rejects every candidate in a multi-attempt run", async (t) => {
  const { run, scope } = await fixture(t);
  await candidate(run, 1, 120);
  await candidate(run, 2, 340);
  await seal(run, ["pause"]);
  const result = await finalizeCompetitionRun(run, scope, { exitCode: 0 });
  assert.equal(result.status, "violated");
  assert.equal(result.adopted.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
});

test("missing final seal and non-zero process exit both fail closed", async (t) => {
  for (const [name, exitCode, withSeal] of [["missing", 0, false], ["crash", 9, true]]) {
    const { run, scope } = await fixture(t, { runId: `run_${name}` });
    await candidate(run, 1, 500);
    if (withSeal) await seal(run);
    const result = await finalizeCompetitionRun(run, scope, { exitCode });
    assert.equal(result.status, "fail_closed");
    assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
    assert.equal(result.rejected.length, 1);
    assert.ok(result.violations.includes("integrity_unavailable"));
  }
});

test("a corrupt candidate fails the complete run closed", async (t) => {
  const { run, scope } = await fixture(t);
  await candidate(run, 1, 100);
  const forged = await candidate(run, 2, 200);
  forged.runId = "another-run";
  await writeJson(path.join(run.stagingCandidatesDir, "candidate-2.json"), forged);
  await seal(run);
  const result = await finalizeCompetitionRun(run, scope, { exitCode: 0 });
  assert.equal(result.status, "fail_closed");
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
  assert.equal(result.rejected.length, 2);
});

test("event binding rejects independent mutation of every protected identity field", async (t) => {
  const { run, scope } = await fixture(t);
  await candidate(run, 1, 900);
  await seal(run);
  const finalized = await finalizeCompetitionRun(run, scope, { exitCode: 0 });
  const original = JSON.parse(await fsp.readFile(finalized.adopted[0].finalPath, "utf8"));
  const mutations = {
    score: 901,
    rom: "pacman",
    detectedAt: "2026-08-21T11:00:00.000Z",
    source: "local_app",
    mameVersion: "0.288",
    runId: "run_forged",
    packId: "pack_forged",
  };
  for (const [field, value] of Object.entries(mutations)) {
    const event = structuredClone(original);
    event[field] = value;
    assert.ok(validateEvent(event, { competitionGuard: run.integrity }).errors.length > 0, field);
  }
  for (const field of ["manifestSha256", "artifactSha256"]) {
    const event = structuredClone(original);
    if (field === "artifactSha256") {
      event.competitionIntegrity.provenance.mode = "remote_verified";
      event.competitionIntegrity.provenance.artifactSha256 = "b".repeat(64);
      event.competitionIntegrity.provenance.artifactSizeBytes = 100;
    } else {
      event.competitionIntegrity.manifestSha256 = "b".repeat(64);
    }
    assert.ok(validateEvent(event, { competitionGuard: run.integrity }).errors.length > 0, field);
  }
});
