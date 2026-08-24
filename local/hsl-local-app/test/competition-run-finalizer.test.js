const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  finalizeCompetitionRun,
  sanitizeMetadata,
} = require("../src/competition-run-finalizer");
const { validateEvent } = require("../src/event-validation");
const {
  armRunInputMonitor,
  canonicalJsonBytes,
  recordRunInputViolation,
  sha256Bytes,
} = require("../src/run-input-integrity");
const { writeCompetitionAppCloseSeal } = require("../src/competition-close-seal");
const { OUTPUT_MONITOR_ARMED_FILENAME } = require("../src/competition-output-monitor");
const {
  authorityPathFor,
  establishProtectedScopeAuthority,
} = require("../src/competition-scope-authority");

const MANIFEST_SHA = "a".repeat(64);
const INPUT_SHA = "b".repeat(64);
const PLAYER_BINDING = "c".repeat(64);

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, canonicalJsonBytes(value));
}

async function fixture(t, options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-finalizer-v2-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const runId = options.runId || "run_finalizer_v2";
  const runRoot = path.join(root, "runtime", "runs", runId);
  const integrityDir = path.join(runRoot, "integrity");
  const stagingCandidatesDir = path.join(runRoot, "events", "candidates");
  const stagingCommitmentsDir = path.join(runRoot, "events", "commitments");
  const scopedQueueRoot = path.join(root, "players", "user", "packs", "pack");
  const scope = {
    scopedQueueRoot,
    scopedPendingDir: path.join(scopedQueueRoot, "events", "pending"),
    scopedRejectedDir: path.join(scopedQueueRoot, "events", "rejected"),
  };
  const provenance = options.developer
    ? { artifactSha256: null, artifactSizeBytes: null, competitionManifestSha256: MANIFEST_SHA, mode: "developer_override" }
    : { artifactSha256: "d".repeat(64), artifactSizeBytes: 1234, competitionManifestSha256: MANIFEST_SHA, mode: "remote_verified" };
  const integrity = {
    version: 2,
    guardVersion: 2,
    runId,
    packId: "space-invaders-s1-w1-r2",
    manifestSha256: MANIFEST_SHA,
    mameVersion: "0.287",
    observedMameVersion: "0.287",
    pluginVersion: "0.4.0",
    weekId: "week-1",
    playerBinding: PLAYER_BINDING,
    captureClientVersion: "0.3.0",
    runInputManifestSha256: INPUT_SHA,
    dips: options.dips || [],
    provenance,
  };
  const run = {
    runId,
    runRoot,
    integrity,
    integrityDir,
    stagingCandidatesDir,
    stagingCommitmentsDir,
    candidateLedgerPath: path.join(integrityDir, "candidate-set.log"),
    runInputManifestSha256: INPUT_SHA,
    weekId: integrity.weekId,
    playerBinding: integrity.playerBinding,
    captureClientVersion: integrity.captureClientVersion,
    automaticCaptureStrategy: "invaders-game-mode-final-v1",
    provenance,
    config: { pack: { gameId: "space-invaders", rom: "invaders" } },
    candidateRecords: [],
  };
  await Promise.all([
    fsp.mkdir(integrityDir, { recursive: true }),
    fsp.mkdir(stagingCandidatesDir, { recursive: true }),
    fsp.mkdir(stagingCommitmentsDir, { recursive: true }),
    fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
    fsp.mkdir(scope.scopedRejectedDir, { recursive: true }),
  ]);
  await establishProtectedScopeAuthority(scope, {
    playerKey: "user",
    packKey: "pack",
    packId: integrity.packId,
    weekId: integrity.weekId,
  }, { establishedAt: "2026-08-21T09:59:00.000Z" });
  await fsp.writeFile(run.candidateLedgerPath, "", "utf8");
  await writeJson(path.join(integrityDir, "identity.json"), {
    version: 2,
    guardVersion: 2,
    runId,
    packId: integrity.packId,
    manifestSha256: integrity.manifestSha256,
    mameVersion: integrity.mameVersion,
    pluginVersion: integrity.pluginVersion,
    weekId: integrity.weekId,
    playerBinding: integrity.playerBinding,
    captureClientVersion: integrity.captureClientVersion,
  });
  await writeJson(path.join(integrityDir, "armed.marker"), { version: 2, runId });
  await writeJson(path.join(integrityDir, "mame-exit.json"), {
    version: 1, runId, exitCode: options.exitCode || 0, observedAt: "2026-08-21T10:30:00.000Z",
  });
  return { root, run, scope };
}

async function addCandidate(run, score = 100) {
  const sequence = run.candidateRecords.length + 1;
  const suffix = String(sequence).padStart(6, "0");
  const candidateId = `${run.runId}_candidate_${suffix}`;
  const value = {
    version: 1,
    candidateId,
    runId: run.runId,
    rom: "invaders",
    score,
    detectedAt: `2026-08-21T10:00:${String(sequence).padStart(2, "0")}.000Z`,
    source: "mame_memory",
    mameVersion: "0.287",
    pluginVersion: "0.4.0",
    strategy: run.automaticCaptureStrategy,
    metadata: { gameOverDetected: true, displayScore: score, trackedScore: score, rollovers: 0 },
  };
  const record = {
    sequence,
    candidateId,
    candidateFile: `candidate_${suffix}.json`,
    commitmentFile: `commitment_${suffix}.json`,
  };
  await writeJson(path.join(run.stagingCandidatesDir, record.candidateFile), value);
  await writeJson(path.join(run.stagingCommitmentsDir, record.commitmentFile), {
    version: 1, sequence, candidateId, candidate: value,
  });
  await fsp.appendFile(run.candidateLedgerPath, `${sequence}\t${candidateId}\t${record.candidateFile}\t${record.commitmentFile}\n`);
  run.candidateRecords.push(record);
  return { record, value };
}

async function seal(run, violations = [], appViolations = []) {
  for (const code of violations) {
    await writeJson(path.join(run.integrityDir, `violation.${code}.marker`), { version: 2, runId: run.runId, code });
  }
  await writeJson(path.join(run.integrityDir, "final.marker"), {
    version: 2,
    runId: run.runId,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    exitPending: true,
    candidateCount: run.candidateRecords.length,
    candidates: run.candidateRecords,
  });
  await writeJson(path.join(run.integrityDir, "state.json"), {
    version: 2,
    runId: run.runId,
    packId: run.integrity.packId,
    phase: violations.length ? "violated" : "armed",
    armed: true,
    stopObserved: true,
    violations,
  });
  let runInputState = await armRunInputMonitor(run, { nowIso: "2026-08-21T10:29:00.000Z" });
  for (const code of appViolations) {
    runInputState = await recordRunInputViolation(run, code, { nowIso: "2026-08-21T10:29:30.000Z" });
  }
  await writeJson(path.join(run.integrityDir, "app", OUTPUT_MONITOR_ARMED_FILENAME), {
    version: 1, runId: run.runId, armedAt: "2026-08-21T10:00:00.000Z",
  });
  const candidates = [];
  const commitments = [];
  for (const record of run.candidateRecords) {
    const candidateBytes = await fsp.readFile(path.join(run.stagingCandidatesDir, record.candidateFile));
    const commitmentBytes = await fsp.readFile(path.join(run.stagingCommitmentsDir, record.commitmentFile));
    candidates.push({
      sequence: record.sequence, candidateFile: record.candidateFile,
      sha256: sha256Bytes(candidateBytes), sizeBytes: candidateBytes.length,
    });
    commitments.push({
      sequence: record.sequence, commitmentFile: record.commitmentFile,
      sha256: sha256Bytes(commitmentBytes), sizeBytes: commitmentBytes.length,
    });
  }
  await writeCompetitionAppCloseSeal(run, {
    exitCode: 0,
    runInputState,
    outputState: { version: 1, runId: run.runId, candidates, commitments, violations: [] },
  }, { nowIso: "2026-08-21T10:30:00.000Z" });
}

async function jsonFiles(directory) {
  return (await fsp.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
}

test("Protected finalizer refuses missing scope authority before publishing", async (t) => {
  const { run, scope } = await fixture(t);
  await addCandidate(run, 120);
  await seal(run);
  await fsp.rm(authorityPathFor(scope));
  await assert.rejects(
    () => finalizeCompetitionRun(run, scope, { exitCode: 0, compact: false }),
    (error) => error?.code === "missing_scope_authority",
  );
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
});

test("remote_verified CLEAN commits receipt and exact pending outputs idempotently", async (t) => {
  const { run, scope } = await fixture(t);
  await addCandidate(run, 120);
  await addCandidate(run, 340);
  await seal(run);
  const result = await finalizeCompetitionRun(run, scope, { exitCode: 0, compact: false });
  assert.equal(result.status, "clean");
  assert.equal(result.adopted.length, 2);
  assert.equal(result.rejected.length, 0);
  const receipt = JSON.parse(await fsp.readFile(path.join(scope.scopedQueueRoot, "competition", "finalized", `${run.runId}.json`)));
  assert.equal(receipt.status, "clean");
  assert.equal(receipt.runInputManifestSha256, INPUT_SHA);
  assert.equal(receipt.outputs.length, 2);
  for (const adopted of result.adopted) {
    const event = JSON.parse(await fsp.readFile(adopted.finalPath));
    assert.equal(event.competitionIntegrity.version, 2);
    assert.equal(event.competitionIntegrity.guardVersion, 2);
    assert.deepEqual(validateEvent(event, { competitionGuard: run.integrity }).errors, []);
  }
  const repeated = await finalizeCompetitionRun(run, scope, { exitCode: 0, compact: false });
  assert.equal(repeated.alreadyFinalized, true);
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), result.adopted.map((item) => item.filename).sort());
});

test("developer_override writes only developer QA output and never productive pending", async (t) => {
  const { run, scope } = await fixture(t, { developer: true });
  await addCandidate(run, 250);
  await seal(run);
  const result = await finalizeCompetitionRun(run, scope, { exitCode: 0, compact: false });
  assert.equal(result.status, "developer_qa");
  assert.equal(result.adopted.length, 0);
  assert.equal(result.qa.length, 1);
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
});

for (const violation of [
  "pause", "state_save", "state_load", "dip_changed", "machine_reset", "menu_opened",
  "speed_changed", "throttle_changed",
]) {
  test(`sticky ${violation} rejects every committed candidate`, async (t) => {
    const { run, scope } = await fixture(t);
    await addCandidate(run, 250);
    await seal(run, [violation]);
    const result = await finalizeCompetitionRun(run, scope, { exitCode: 0, compact: false });
    assert.equal(result.status, "violated");
    assert.equal(result.adopted.length, 0);
    assert.equal(result.rejected.length, 1);
    assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
  });
}

test("app-owned run_input_changed is sticky and rejects the run", async (t) => {
  const { run, scope } = await fixture(t);
  await addCandidate(run, 400);
  await seal(run, [], ["run_input_changed"]);
  const result = await finalizeCompetitionRun(run, scope, { compact: false });
  assert.equal(result.status, "violated");
  assert.deepEqual(result.violations, ["run_input_changed"]);
});

const attacks = {
  "score editado": async ({ run, candidate }) => {
    candidate.value.score += 1;
    await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  },
  "rom editada": async ({ run, candidate }) => {
    candidate.value.rom = "invadpt2";
    await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  },
  "detectedAt editado": async ({ run, candidate }) => {
    candidate.value.detectedAt = "2026-08-21T10:59:59.000Z";
    await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  },
  "source editado": async ({ run, candidate }) => {
    candidate.value.source = "manual";
    await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  },
  "metadata editada": async ({ run, candidate }) => {
    candidate.value.metadata.displayScore += 10;
    await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  },
  "candidateId editado": async ({ run, candidate }) => {
    candidate.value.candidateId = `${run.runId}_candidate_forged`;
    await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  },
  "candidate anadido": async ({ run }) => writeJson(path.join(run.stagingCandidatesDir, "candidate_000002.json"), {}),
  "candidate duplicado": async ({ run, candidate }) => {
    await fsp.copyFile(
      path.join(run.stagingCandidatesDir, candidate.record.candidateFile),
      path.join(run.stagingCandidatesDir, "candidate_000002.json"),
    );
    await fsp.copyFile(
      path.join(run.stagingCommitmentsDir, candidate.record.commitmentFile),
      path.join(run.stagingCommitmentsDir, "commitment_000002.json"),
    );
  },
  "candidate borrado": async ({ run, candidate }) => fsp.rm(path.join(run.stagingCandidatesDir, candidate.record.candidateFile)),
  "candidate renombrado": async ({ run, candidate }) => fsp.rename(
    path.join(run.stagingCandidatesDir, candidate.record.candidateFile),
    path.join(run.stagingCandidatesDir, "candidate_000002.json"),
  ),
  "commitment ausente": async ({ run, candidate }) => fsp.rm(path.join(run.stagingCommitmentsDir, candidate.record.commitmentFile)),
  "commitment extra": async ({ run }) => writeJson(path.join(run.stagingCommitmentsDir, "commitment_000002.json"), {}),
};

attacks["candidate y commitment editados coherentemente"] = async ({ run, candidate }) => {
  candidate.value.score = 99990;
  candidate.value.metadata.displayScore = 99990;
  candidate.value.metadata.trackedScore = 99990;
  await writeJson(path.join(run.stagingCandidatesDir, candidate.record.candidateFile), candidate.value);
  await writeJson(path.join(run.stagingCommitmentsDir, candidate.record.commitmentFile), {
    version: 1,
    sequence: candidate.record.sequence,
    candidateId: candidate.record.candidateId,
    candidate: candidate.value,
  });
};

for (const [name, mutate] of Object.entries(attacks)) {
  test(`${name} despues del commitment nunca llega a pending`, async (t) => {
    const { run, scope } = await fixture(t, { runId: `run_attack_${name.replace(/\W+/g, "_")}` });
    const candidate = await addCandidate(run, 500);
    await seal(run);
    await mutate({ run, candidate });
    const result = await finalizeCompetitionRun(run, scope, { compact: false });
    assert.equal(result.status, "fail_closed");
    assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
    assert.ok(result.violations.includes("integrity_unavailable"));
  });
}

test("candidate cap above 128 fails closed before publishing", async (t) => {
  const { run, scope } = await fixture(t, { runId: "run_candidate_cap" });
  await seal(run);
  const markerPath = path.join(run.integrityDir, "final.marker");
  const marker = JSON.parse(await fsp.readFile(markerPath, "utf8"));
  marker.candidateCount = 129;
  marker.candidates = Array.from({ length: 129 }, (_, index) => {
    const suffix = String(index + 1).padStart(6, "0");
    return {
      sequence: index + 1,
      candidateId: `${run.runId}_candidate_${suffix}`,
      candidateFile: `candidate_${suffix}.json`,
      commitmentFile: `commitment_${suffix}.json`,
    };
  });
  await writeJson(markerPath, marker);
  const result = await finalizeCompetitionRun(run, scope, { compact: false });
  assert.equal(result.status, "fail_closed");
  assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
  assert.ok(result.violations.includes("integrity_unavailable"));
});

test("missing or corrupt app close seal can never produce CLEAN", async (t) => {
  const mutations = {
    missing: async (run) => fsp.rm(path.join(run.integrityDir, "app", "app-close-seal.json")),
    corrupt_json: async (run) => fsp.writeFile(path.join(run.integrityDir, "app", "app-close-seal.json"), "{bad"),
    runId: async (run, value) => { value.runId = "other-run"; },
    input_hash: async (_run, value) => { value.runInputManifestSha256 = "e".repeat(64); },
    final_hash: async (_run, value) => { value.finalMarkerSha256 = "e".repeat(64); },
    ledger_hash: async (_run, value) => { value.candidateLedgerSha256 = "e".repeat(64); },
    candidate_hash: async (_run, value) => { value.candidates[0].candidateSha256 = "e".repeat(64); },
    commitment_hash: async (_run, value) => { value.candidates[0].commitmentSha256 = "e".repeat(64); },
    exit_code: async (_run, value) => { value.exitCode = 7; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const { run, scope } = await fixture(t, { runId: `run_close_seal_${name}` });
      await addCandidate(run, 650);
      await seal(run);
      const sealPath = path.join(run.integrityDir, "app", "app-close-seal.json");
      if (["missing", "corrupt_json"].includes(name)) await mutate(run);
      else {
        const value = JSON.parse(await fsp.readFile(sealPath, "utf8"));
        await mutate(run, value);
        await fsp.writeFile(sealPath, canonicalJsonBytes(value));
      }
      const result = await finalizeCompetitionRun(run, scope, { compact: false });
      assert.equal(result.status, "fail_closed");
      assert.deepEqual(await jsonFiles(scope.scopedPendingDir), []);
    });
  }
});

const crashScenarios = {
  "despues del plan": () => ({ afterPlan() { throw new Error("simulated-crash"); } }),
  "despues del receipt": () => ({ afterReceipt() { throw new Error("simulated-crash"); } }),
  "despues del output 1 de 2": () => {
    let outputs = 0;
    return { afterOutput(output) { if (output.kind === "event" && ++outputs === 1) throw new Error("simulated-crash"); } };
  },
  "despues del output 2 de 2": () => {
    let outputs = 0;
    return { afterOutput(output) { if (output.kind === "event" && ++outputs === 2) throw new Error("simulated-crash"); } };
  },
  "antes del commit": () => ({ beforeCommit() { throw new Error("simulated-crash"); } }),
};

for (const [scenario, fault] of Object.entries(crashScenarios)) {
  test(`journal resumes ${scenario} with exact idempotent bytes`, async (t) => {
    const { run, scope } = await fixture(t, { runId: `run_crash_${scenario.replace(/\W+/g, "_")}` });
    await addCandidate(run, 100);
    await addCandidate(run, 200);
    await seal(run);
    await assert.rejects(() => finalizeCompetitionRun(run, scope, {
      compact: false,
      ...fault(),
    }), /simulated-crash/);
    await assert.rejects(() => fsp.access(path.join(run.integrityDir, "finalization.json")));

    const recovered = await finalizeCompetitionRun(run, scope, { compact: false });
    assert.equal(recovered.status, "clean");
    assert.equal(recovered.adopted.length, 2);
    assert.equal((await jsonFiles(scope.scopedPendingDir)).length, 2);
    const plan = JSON.parse(await fsp.readFile(path.join(run.integrityDir, "finalization-plan.json"), "utf8"));
    for (const output of plan.outputs.filter((item) => item.kind === "event")) {
      const bytes = await fsp.readFile(path.join(scope.scopedPendingDir, output.filename));
      assert.equal(sha256Bytes(bytes), output.sha256);
    }
    const repeated = await finalizeCompetitionRun(run, scope, { compact: false });
    assert.equal(repeated.alreadyFinalized, true);
    assert.equal((await jsonFiles(scope.scopedPendingDir)).length, 2);
  });
}

test("Node metadata sanitizer rejects prototype keys at every relevant depth", () => {
  for (const raw of [
    '{"__proto__":{"polluted":true}}',
    '{"constructor":{}}',
    '{"prototype":{}}',
    '{"nested":{"__proto__":{}}}',
  ]) {
    assert.throws(() => sanitizeMetadata(JSON.parse(raw)), /key prohibida/);
  }
  assert.throws(() => sanitizeMetadata(Object.create({ inherited: true })), /tipo no JSON/);
  const clean = sanitizeMetadata({ nested: { score: 7 } });
  assert.equal(Object.getPrototypeOf(clean), null);
  assert.equal(Object.getPrototypeOf(clean.nested), null);
  assert.equal({}.polluted, undefined);
});
