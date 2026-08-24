const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { deriveCompetitionPlayerBinding } = require("../src/competition-player-binding");
const {
  checkProtectedCompetitionEligibility,
  requiresProtectedCompetitionEvidence,
} = require("../src/competition-submission-eligibility");
const { submitPendingFile } = require("../src/submission-service");
const { canonicalJsonBytes, sha256Bytes } = require("../src/run-input-integrity");
const {
  buildPlayerPendingIndex,
  buildScopedSubmitConfig,
  derivePackKey,
  derivePlayerKey,
  ensureScopedQueue,
} = require("../src/scoped-queue");
const { createSessionResult } = require("../src/session-result");

const RUN_ID = "run_submission_v2";
const PACK_ID = "space-invaders-s1-w1-r2";
const WEEK_ID = "week-1";
const USER_ID = "user-one";
const PLAYER_BINDING = deriveCompetitionPlayerBinding(USER_ID);
const SESSION = { email: "player@example.com", hasSession: true, userId: USER_ID };

function protectedEvent() {
  const provenance = {
    artifactSha256: "d".repeat(64),
    artifactSizeBytes: 1234,
    competitionManifestSha256: "a".repeat(64),
    mode: "remote_verified",
  };
  return {
    schemaVersion: 1,
    candidateId: `${RUN_ID}_candidate_000001`,
    runId: RUN_ID,
    packId: PACK_ID,
    game: "Space Invaders",
    rom: "invaders",
    score: 1230,
    detectedAt: "2026-08-21T10:00:01.000Z",
    source: "mame_memory",
    mameVersion: "0.287",
    pluginVersion: "0.4.0",
    detection: { method: "automatic_adapter_candidate_v2", manualConfirm: false, gameOverDetected: true, strategy: "invaders-game-mode-final-v1" },
    scoreData: { displayScore: 1230, trackedScore: 1230, rollovers: 0 },
    captureMetadata: { gameOverDetected: true },
    competitionIntegrity: {
      version: 2,
      guardVersion: 2,
      runId: RUN_ID,
      weekId: WEEK_ID,
      playerBinding: PLAYER_BINDING,
      packId: PACK_ID,
      manifestSha256: "a".repeat(64),
      mameVersion: "0.287",
      pluginVersion: "0.4.0",
      captureClientVersion: "0.3.0",
      runInputManifestSha256: "b".repeat(64),
      dips: [],
      violations: [],
      provenance,
      event: {
        candidateId: `${RUN_ID}_candidate_000001`,
        rom: "invaders",
        score: 1230,
        detectedAt: "2026-08-21T10:00:01.000Z",
        source: "mame_memory",
      },
    },
  };
}

async function fixture(t, mutate = null) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-submit-eligibility-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const playerKey = derivePlayerKey(SESSION);
  const packKey = derivePackKey({ pack: { packId: PACK_ID } });
  const scopedQueueRoot = path.join(root, "players", playerKey, "packs", packKey);
  const eventsRoot = path.join(scopedQueueRoot, "events");
  const config = {
    userDataDir: root,
    clientVersion: "0.3.0",
    defaultWeekId: WEEK_ID,
    eventsPendingDirAbs: path.join(eventsRoot, "pending"),
    eventsSentDirAbs: path.join(eventsRoot, "sent"),
    eventsFailedDirAbs: path.join(eventsRoot, "failed"),
    eventsRejectedDirAbs: path.join(eventsRoot, "rejected"),
    recentEventThresholdMs: 0,
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    webBaseUrl: "https://high-score-league.example",
    pack: {
      packVersion: 2,
      gameId: "space-invaders",
      packId: PACK_ID,
      weekId: WEEK_ID,
      rom: "invaders",
      webBaseUrl: "https://high-score-league.vercel.app",
      contract: {
        version: 2,
        mame: { profiles: { competition: { integrity: { version: 1 } } } },
        capture: { automatic: { version: 1, strategy: "invaders-game-mode-final-v1" } },
      },
    },
    competitionPlayerBinding: PLAYER_BINDING,
    scopedQueue: {
      packKey,
      playerKey,
      scopedQueueRoot,
      meta: { player: { userId: USER_ID } },
    },
  };
  await Promise.all([
    fsp.mkdir(config.eventsPendingDirAbs, { recursive: true }),
    fsp.mkdir(config.eventsSentDirAbs, { recursive: true }),
    fsp.mkdir(config.eventsFailedDirAbs, { recursive: true }),
    fsp.mkdir(config.eventsRejectedDirAbs, { recursive: true }),
  ]);
  const event = protectedEvent();
  mutate?.(event, config);
  const filename = "competition_test.json";
  const sourcePath = path.join(config.eventsPendingDirAbs, filename);
  const eventBytes = canonicalJsonBytes(event);
  await fsp.writeFile(sourcePath, eventBytes);
  const receipt = {
    version: 1,
    runId: RUN_ID,
    weekId: WEEK_ID,
    playerBinding: PLAYER_BINDING,
    packId: PACK_ID,
    manifestSha256: "a".repeat(64),
    runInputManifestSha256: "b".repeat(64),
    captureClientVersion: "0.3.0",
    provenance: protectedEvent().competitionIntegrity.provenance,
    status: "clean",
    violations: [],
    outputs: [{
      candidateId: `${RUN_ID}_candidate_000001`,
      filename,
      sha256: sha256Bytes(canonicalJsonBytes(protectedEvent())),
      destination: "pending",
    }],
    finalizedAt: "2026-08-21T10:30:00.000Z",
  };
  const receiptPath = path.join(scopedQueueRoot, "competition", "finalized", `${RUN_ID}.json`);
  const receiptBytes = canonicalJsonBytes(receipt);
  await fsp.mkdir(path.dirname(receiptPath), { recursive: true });
  await fsp.writeFile(receiptPath, receiptBytes);
  const integrityDir = path.join(root, "runtime", "runs", RUN_ID, "integrity");
  const planBytes = canonicalJsonBytes({ version: 1, runId: RUN_ID, fixture: true });
  await fsp.mkdir(integrityDir, { recursive: true });
  await fsp.writeFile(path.join(integrityDir, "finalization-plan.json"), planBytes);
  await fsp.writeFile(path.join(integrityDir, "finalization.json"), canonicalJsonBytes({
    version: 1,
    runId: RUN_ID,
    status: "clean",
    planSha256: sha256Bytes(planBytes),
    receiptSha256: sha256Bytes(receiptBytes),
    outputs: [{
      kind: "event",
      candidateId: `${RUN_ID}_candidate_000001`,
      filename,
      sha256: sha256Bytes(canonicalJsonBytes(protectedEvent())),
      destination: "pending",
    }],
    finalizedAt: receipt.finalizedAt,
    committedAt: receipt.finalizedAt,
  }));
  return { config, event, filename, sourcePath };
}

test("a CLEAN scoped receipt and finalization commit authorize exact bytes", async (t) => {
  const value = await fixture(t);
  const result = await checkProtectedCompetitionEligibility(value.config, value.event, value.sourcePath);
  assert.equal(result.eligible, true);
  assert.equal(result.kind, "protected_v2");
});

test("protected-required comes only from the app-owned pack contract", async (t) => {
  const value = await fixture(t);
  assert.equal(requiresProtectedCompetitionEvidence(value.config), true);
  const rewritten = { ...value.event };
  delete rewritten.competitionIntegrity;
  rewritten.packId = "attacker-legacy-pack";
  const result = await checkProtectedCompetitionEligibility(value.config, rewritten, value.sourcePath);
  assert.equal(result.eligible, false);
  assert.equal(result.code, "COMPETITION_EVIDENCE_REQUIRED");

  const legacyConfig = { ...value.config, pack: { packId: "legacy-pack", weekId: WEEK_ID, rom: "invaders" } };
  assert.equal(requiresProtectedCompetitionEvidence(legacyConfig), false);
  assert.deepEqual(
    await checkProtectedCompetitionEligibility(legacyConfig, rewritten, value.sourcePath),
    { eligible: true, kind: "legacy" },
  );
});

test("deleted, v1 and corrupt evidence in protected scope are rejected before auth and HTTP", async (t) => {
  for (const [name, mutate] of [
    ["deleted", (event) => { delete event.competitionIntegrity; }],
    ["v1", (event) => { event.competitionIntegrity = { version: 1 }; }],
    ["corrupt-v2", (event) => { event.competitionIntegrity.guardVersion = 1; }],
    ["rewritten-legacy", (event) => {
      delete event.competitionIntegrity;
      event.packId = "legacy-forged";
      event.runId = "legacy-forged";
    }],
  ]) {
    await t.test(name, async () => {
      const value = await fixture(t, mutate);
      let sessionResolutions = 0;
      let requests = 0;
      const result = await submitPendingFile(value.config, value.filename, {
        getSessionResultImpl: async () => { sessionResolutions += 1; throw new Error("must-not-resolve"); },
        fetchImpl: async () => { requests += 1; throw new Error("must-not-fetch"); },
      });
      assert.equal(result.action, "rejected");
      assert.equal(result.httpRequests, 0);
      assert.equal(sessionResolutions, 0);
      assert.equal(requests, 0);
    });
  }
});

const pendingAttacks = {
  "score + binding": (event) => { event.score = 9999; event.competitionIntegrity.event.score = 9999; },
  "rom + binding": (event) => { event.rom = "pacman"; event.competitionIntegrity.event.rom = "pacman"; },
  weekId: (event) => { event.competitionIntegrity.weekId = "week-2"; },
  playerBinding: (event) => { event.competitionIntegrity.playerBinding = "e".repeat(64); },
  packId: (event) => { event.packId = "other-pack"; event.competitionIntegrity.packId = "other-pack"; },
  manifest: (event) => {
    event.competitionIntegrity.manifestSha256 = "e".repeat(64);
    event.competitionIntegrity.provenance.competitionManifestSha256 = "e".repeat(64);
  },
  runId: (event) => { event.runId = "other-run"; event.competitionIntegrity.runId = "other-run"; },
  candidateId: (event) => { event.candidateId = "other-candidate"; event.competitionIntegrity.event.candidateId = "other-candidate"; },
  provenance: (event) => { event.competitionIntegrity.provenance.artifactSha256 = "e".repeat(64); },
  captureClientVersion: (event) => { event.competitionIntegrity.captureClientVersion = "9.9.9"; },
  runInputManifestSha256: (event) => { event.competitionIntegrity.runInputManifestSha256 = "e".repeat(64); },
};

for (const [name, mutate] of Object.entries(pendingAttacks)) {
  test(`pending attack ${name} is rejected with zero auth/HTTP`, async (t) => {
    const value = await fixture(t, mutate);
    let sessionResolutions = 0;
    let requests = 0;
    const result = await submitPendingFile(value.config, value.filename, {
      getSessionResultImpl: async () => { sessionResolutions += 1; throw new Error("must-not-resolve"); },
      fetchImpl: async () => { requests += 1; throw new Error("must-not-fetch"); },
    });
    assert.equal(result.action, "rejected");
    assert.equal(result.httpRequests, 0);
    assert.equal(sessionResolutions, 0);
    assert.equal(requests, 0);
  });
}

test("wrong account scope and developer_override are second-barrier local rejections", async (t) => {
  const wrongAccount = await fixture(t, (_event, config) => {
    config.competitionPlayerBinding = deriveCompetitionPlayerBinding("user-two");
    config.scopedQueue.meta.player.userId = "user-two";
  });
  assert.equal((await checkProtectedCompetitionEligibility(wrongAccount.config, wrongAccount.event, wrongAccount.sourcePath)).eligible, false);

  const developer = await fixture(t, (event) => {
    event.competitionIntegrity.provenance = {
      artifactSha256: null,
      artifactSizeBytes: null,
      competitionManifestSha256: "a".repeat(64),
      mode: "developer_override",
    };
  });
  const result = await submitPendingFile(developer.config, developer.filename, {
    fetchImpl: async () => { throw new Error("must-not-fetch"); },
  });
  assert.equal(result.action, "rejected");
  assert.equal(result.httpRequests, 0);
});

test("a rejected event copied back to pending without CLEAN receipt makes zero requests", async (t) => {
  const value = await fixture(t);
  await fsp.rm(path.join(value.config.scopedQueue.scopedQueueRoot, "competition", "finalized", `${RUN_ID}.json`));
  let requests = 0;
  const result = await submitPendingFile(value.config, value.filename, {
    fetchImpl: async () => { requests += 1; throw new Error("must-not-fetch"); },
  });
  assert.equal(result.action, "rejected");
  assert.equal(requests, 0);
});

test("restart keeps protected scope and rejects a fully rewritten legacy event before auth or HTTP", async (t) => {
  const value = await fixture(t);
  await ensureScopedQueue(value.config, SESSION, { now: "2026-08-24T10:00:00.000Z" });

  const index = await buildPlayerPendingIndex({ userDataDir: value.config.userDataDir }, SESSION);
  assert.equal(index.records.length, 1);
  assert.equal(index.records[0].competitionMode, "protected_v2");
  const reconstructed = buildScopedSubmitConfig({
    clientVersion: "0.3.0",
    hslOrigin: "https://highscoreleague.com",
    remoteConfiguration: { source: "launcher" },
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    userDataDir: value.config.userDataDir,
    webBaseUrl: "https://highscoreleague.com",
  }, index.records[0]);
  assert.equal(reconstructed.pack.contract, undefined);
  assert.equal(requiresProtectedCompetitionEvidence(reconstructed), true);

  const rewritten = { ...value.event };
  delete rewritten.competitionIntegrity;
  delete rewritten.candidateId;
  rewritten.runId = "legacy-rewritten";
  rewritten.packId = "legacy-rewritten";
  await fsp.writeFile(value.sourcePath, canonicalJsonBytes(rewritten));
  let sessionResolutions = 0;
  let requests = 0;
  const result = await submitPendingFile(reconstructed, value.filename, {
    getSessionResultImpl: async () => { sessionResolutions += 1; throw new Error("must-not-resolve"); },
    fetchImpl: async () => { requests += 1; throw new Error("must-not-fetch"); },
  });
  assert.equal(result.action, "rejected");
  assert.equal(result.eligibilityCode, "COMPETITION_EVIDENCE_REQUIRED");
  assert.equal(sessionResolutions, 0);
  assert.equal(requests, 0);
});

for (const declaredOrigin of ["https://high-score-league.vercel.app", "https://attacker.example"]) {
  test(`offline protected pending survives restart without pack and sends only to launcher origin (${declaredOrigin})`, async (t) => {
    const value = await fixture(t, (_event, config) => { config.pack.webBaseUrl = declaredOrigin; });
    await ensureScopedQueue(value.config, SESSION, { now: "2026-08-24T10:00:00.000Z" });

    const index = await buildPlayerPendingIndex({ userDataDir: value.config.userDataDir }, SESSION);
    const reconstructed = buildScopedSubmitConfig({
      clientVersion: "0.3.0",
      hslOrigin: "https://highscoreleague.com",
      remoteConfiguration: { source: "launcher" },
      supabaseAnonKey: "anon-key",
      supabaseUrl: "https://example.supabase.co",
      userDataDir: value.config.userDataDir,
      webBaseUrl: "https://highscoreleague.com",
    }, index.records[0]);
    assert.equal(reconstructed.pack.contract, undefined);
    assert.equal(reconstructed.pack.webBaseUrl, declaredOrigin);
    assert.equal(reconstructed.webBaseUrl, "https://highscoreleague.com");

    const requested = [];
    const nowMs = Date.now();
    const sessionResult = createSessionResult({
      status: "valid",
      storedSession: {
        supabaseUrl: "https://example.supabase.co",
        session: {
          access_token: "scope-secret-token",
          expires_at: Math.floor(nowMs / 1000) + 3600,
          refresh_token: "scope-secret-refresh",
        },
        user: { id: USER_ID },
      },
    });
    const result = await submitPendingFile(reconstructed, value.filename, {
      fetchImpl: async (url, options) => {
        requested.push({ authorization: options.headers.Authorization, url: String(url) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      nowMs,
      sessionResult,
    });
    assert.equal(result.action, "sent", JSON.stringify(result));
    assert.deepEqual(requested, [{
      authorization: "Bearer scope-secret-token",
      url: "https://highscoreleague.com/api/submissions/ingest",
    }]);
    assert.equal(requested.some((item) => item.url.startsWith(declaredOrigin)), declaredOrigin === "https://highscoreleague.com");
  });
}
