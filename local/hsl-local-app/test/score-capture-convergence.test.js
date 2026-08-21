const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createPendingAutoSubmitCoordinator } = require("../src/pending-auto-submit-coordinator");
const { createScoreCaptureConvergence } = require("../src/score-capture-convergence");
const { createSessionResult } = require("../src/session-result");
const { listJsonFiles, readEventFile } = require("../src/event-files");
const { moveFileSafe } = require("../src/file-queue");
const { buildScopedSubmitConfig } = require("../src/scoped-queue");
const { submitAll, submitPendingFile } = require("../src/submission-service");

async function tempScope(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-score-convergence-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const stagingPendingDir = path.join(root, "runtime", "runs", "run-a", "events", "pending");
  const scopedPendingDir = path.join(root, "players", "player-a", "packs", "pack-x", "events", "pending");
  const sentDir = path.join(root, "players", "player-a", "packs", "pack-x", "events", "sent");
  const failedDir = path.join(root, "players", "player-a", "packs", "pack-x", "events", "failed");
  const rejectedDir = path.join(root, "players", "player-a", "packs", "pack-x", "events", "rejected");
  await Promise.all([
    fsp.mkdir(stagingPendingDir, { recursive: true }),
    fsp.mkdir(scopedPendingDir, { recursive: true }),
    fsp.mkdir(sentDir, { recursive: true }),
    fsp.mkdir(failedDir, { recursive: true }),
    fsp.mkdir(rejectedDir, { recursive: true }),
  ]);
  return { failedDir, rejectedDir, root, scopedPendingDir, sentDir, stagingPendingDir };
}

function fakeWatcher() {
  let callback = null;
  let errorCallback = null;
  let closeCalls = 0;
  return {
    emit() { callback?.("rename", null); },
    emitError(error) { errorCallback?.(error); },
    get closeCalls() { return closeCalls; },
    watch(_dir, options, next) {
      assert.equal(options.persistent, false);
      callback = next;
      return {
        close() { closeCalls += 1; },
        on(event, listener) { if (event === "error") errorCallback = listener; },
      };
    },
  };
}

function monitorFor(scope, watcher, overrides = {}) {
  return createScoreCaptureConvergence({
    packKey: "pack-x",
    playerKey: "player-a",
    runId: "run-a",
    scopedPendingDir: scope.scopedPendingDir,
    stagingPendingDir: scope.stagingPendingDir,
    watchImpl: watcher.watch,
    ...overrides,
  });
}

function validEvent(score = 1230, overrides = {}) {
  return {
    schemaVersion: 1,
    game: "Space Invaders",
    rom: "invaders",
    score,
    detectedAt: "2026-08-19T10:00:00Z",
    source: "mame_memory",
    mameVersion: "MAME 0.265",
    pluginVersion: "0.2.0",
    ...overrides,
  };
}

function competitionGuard(overrides = {}) {
  return {
    version: 1,
    guardVersion: 1,
    runId: "run-a",
    packId: "space-invaders-test",
    manifestSha256: "a".repeat(64),
    mameVersion: "0.287",
    pluginVersion: "0.3.0",
    dips: [{ portTag: ":IN2", mask: 3, value: 0 }],
    provenance: {
      artifactSha256: null,
      artifactSizeBytes: null,
      competitionManifestSha256: "a".repeat(64),
      mode: "developer_override",
    },
    event: {
      candidateId: "run-a_candidate_000001",
      rom: "invaders",
      score: 1230,
      detectedAt: "2026-08-19T10:00:00Z",
      source: "mame_memory",
    },
    ...overrides,
  };
}

function guardedEvent(violations = [], overrides = {}) {
  const expected = competitionGuard();
  const integrity = { ...expected, ...overrides, violations };
  return validEvent(1230, {
    candidateId: expected.event.candidateId,
    runId: expected.runId,
    packId: expected.packId,
    mameVersion: expected.mameVersion,
    pluginVersion: expected.pluginVersion,
    competitionIntegrity: integrity,
  });
}

async function publishAtomically(dir, filename, event) {
  const finalPath = path.join(dir, filename);
  const temporaryPath = `${finalPath}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(event)}\n`, "utf8");
  await fsp.rename(temporaryPath, finalPath);
  return finalPath;
}

async function withoutConsole(operation) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await operation();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("a temporary publication is ignored and the final JSON is adopted while MAME remains open", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  const requests = [];
  const monitor = monitorFor(scope, watcher, {
    onAdopted(event) { requests.push(event); },
  });
  monitor.start();
  const temporaryPath = path.join(scope.stagingPendingDir, "score.json.tmp");
  await fsp.writeFile(temporaryPath, "{", "utf8");

  watcher.emit();
  await monitor.requestRescan();
  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), []);
  assert.deepEqual(await fsp.readdir(scope.stagingPendingDir), ["score.json.tmp"]);
  assert.equal(requests.length, 0);

  await fsp.writeFile(temporaryPath, `${JSON.stringify(validEvent())}\n`, "utf8");
  await fsp.rename(temporaryPath, path.join(scope.stagingPendingDir, "score.json"));
  watcher.emit();
  await monitor.requestRescan();

  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), ["score.json"]);
  assert.deepEqual(await fsp.readdir(scope.stagingPendingDir), []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].trigger, "score-adopted");
  assert.equal(requests[0].phase, "live");
  await monitor.close();
});

test("duplicate watcher hints coalesce without duplicate adoption", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  let submitRequests = 0;
  const monitor = monitorFor(scope, watcher, {
    onAdopted() { submitRequests += 1; },
  });
  monitor.start();
  await publishAtomically(scope.stagingPendingDir, "only.json", validEvent());

  for (let index = 0; index < 5; index += 1) watcher.emit();
  await monitor.requestRescan();

  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), ["only.json"]);
  assert.equal(submitRequests, 1);
  assert.equal(monitor.getDiagnostics().liveAdopted, 1);
  assert.ok(monitor.getDiagnostics().scanRuns <= 2);
  await monitor.close();
});

test("a mutation during adoption queues one later scan and never runs scans concurrently", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  let releaseFirst;
  let signalFirstStarted;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  let activeScans = 0;
  let maxActiveScans = 0;
  let scanCalls = 0;
  const monitor = monitorFor(scope, watcher, {
    async adoptImpl() {
      scanCalls += 1;
      activeScans += 1;
      maxActiveScans = Math.max(maxActiveScans, activeScans);
      if (scanCalls === 1) {
        signalFirstStarted();
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
      activeScans -= 1;
      return { adopted: [], skippedLegacy: [] };
    },
  });
  monitor.start();
  watcher.emit();
  await firstStarted;
  for (let index = 0; index < 5; index += 1) watcher.emit();
  const drained = monitor.requestRescan();
  releaseFirst();
  await drained;

  assert.equal(scanCalls, 2);
  assert.equal(maxActiveScans, 1);
  assert.equal(monitor.getDiagnostics().rescanQueued, false);
  await monitor.close({ finalRescan: false });
});

test("a close-time authoritative scan recovers a completely missed watcher event", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  const phases = [];
  const monitor = monitorFor(scope, watcher, {
    onAdopted(event) { phases.push(event.phase); },
  });
  monitor.start();
  await publishAtomically(scope.stagingPendingDir, "missed.json", validEvent());

  const result = await monitor.close();

  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), ["missed.json"]);
  assert.deepEqual(phases, ["close"]);
  assert.equal(result.diagnostics.closeAdopted, 1);
  assert.equal(result.diagnostics.activeRun, null);
  assert.match(result.diagnostics.lastRun, /^run_[a-f0-9]{12}$/);
  assert.equal(result.diagnostics.watching, false);
  assert.equal(watcher.closeCalls, 1);
});

test("the frozen run scope never follows a later player or pack selection", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  const visibleScope = { playerKey: "player-a", packKey: "pack-x" };
  const monitor = monitorFor(scope, watcher);
  monitor.start();
  visibleScope.playerKey = "player-b";
  visibleScope.packKey = "pack-y";
  await publishAtomically(scope.stagingPendingDir, "frozen.json", validEvent());

  watcher.emit();
  await monitor.requestRescan();

  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), ["frozen.json"]);
  const redirected = path.join(scope.root, "players", visibleScope.playerKey, "packs", visibleScope.packKey, "events", "pending");
  assert.deepEqual(await fsp.readdir(redirected).catch(() => []), []);
  assert.match(monitor.getDiagnostics().activeRun, /^run_[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(monitor.getDiagnostics()).includes(scope.root), false);
  await monitor.close();
});

test("malformed final JSON is preserved in scoped pending and remains invalid for submission", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  const monitor = monitorFor(scope, watcher);
  monitor.start();
  await fsp.writeFile(path.join(scope.stagingPendingDir, "malformed.json"), "{\n", "utf8");

  watcher.emit();
  await monitor.requestRescan();

  const event = await readEventFile(scope.scopedPendingDir, "malformed.json");
  assert.equal(event.ok, false);
  assert.match(event.errors.join(" "), /JSON inválido/);
  assert.deepEqual(await fsp.readdir(scope.stagingPendingDir), []);
  let posts = 0;
  const result = await submitPendingFile({
    clientVersion: "0.2.0",
    defaultWeekId: "week-1",
    eventsFailedDirAbs: scope.failedDir,
    eventsPendingDirAbs: scope.scopedPendingDir,
    eventsRejectedDirAbs: scope.rejectedDir,
    eventsSentDirAbs: scope.sentDir,
    recentEventThresholdMs: -1,
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    webBaseUrl: "https://hsl.example",
  }, "malformed.json", {
    fetchImpl: async () => { posts += 1; throw new Error("must not post"); },
  });
  assert.equal(result.outcome, "local-invalid");
  assert.equal(posts, 0);
  assert.deepEqual(await listJsonFiles(scope.failedDir), ["malformed.json"]);
  await monitor.close();
});

test("watch setup or spawn failure leaves no live resource and performs no remote wait", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  const monitor = monitorFor(scope, watcher);
  monitor.start();

  await monitor.close({ finalRescan: false });

  assert.equal(watcher.closeCalls, 1);
  assert.equal(monitor.getDiagnostics().closed, true);
  assert.equal(monitor.getDiagnostics().watching, false);

  const broken = monitorFor(scope, { watch() { throw Object.assign(new Error("unavailable"), { code: "ENOSYS" }); } });
  broken.start();
  assert.equal(broken.getDiagnostics().watchErrors, 1);
  assert.equal(broken.getDiagnostics().lastWatchErrorCode, "ENOSYS");
  await broken.close({ finalRescan: false });
  assert.equal(broken.getDiagnostics().closed, true);
});

test("full live chain reaches sent before simulated MAME close and handles A/B/C exactly once", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  let mameOpen = true;
  let activeSubmits = 0;
  let maxActiveSubmits = 0;
  let posts = 0;
  let submitPromise = Promise.resolve();
  const storedSession = {
    supabaseUrl: "https://example.supabase.co",
    session: {
      access_token: "test-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "test-refresh-token",
    },
    user: { id: "user-a" },
  };
  const sessionResult = createSessionResult({ status: "valid", storedSession });
  const submissionConfig = buildScopedSubmitConfig({
    clientVersion: "0.2.0",
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
  }, {
    meta: {
      pack: {
        gameId: "space-invaders",
        packId: "space-invaders-week-1",
        rom: "invaders",
        webBaseUrl: "https://hsl.example",
        weekId: "week-1",
      },
      player: { playerKey: "player-a", userId: "user-a" },
      schemaVersion: 1,
    },
    scope: {
      eventsRoot: path.dirname(scope.scopedPendingDir),
      packKey: "pack-x",
      playerKey: "player-a",
      scopedFailedDir: scope.failedDir,
      scopedPendingDir: scope.scopedPendingDir,
      scopedQueueRoot: path.dirname(path.dirname(scope.scopedPendingDir)),
      scopedRejectedDir: scope.rejectedDir,
      scopedSentDir: scope.sentDir,
    },
  });
  assert.equal(submissionConfig.recentEventThresholdMs, 0);
  const coordinator = createPendingAutoSubmitCoordinator({
    async inspect() {
      const pending = await listJsonFiles(scope.scopedPendingDir);
      return {
        connection: { reachability: "connected", reachabilityGeneration: 1 },
        index: { revision: pending.join("|") || "empty", totals: { pending: pending.length } },
        playerKey: "player-a",
        session: { hasSession: true, userId: "user-a" },
        userId: "user-a",
        webBaseUrl: "https://hsl.example",
      };
    },
    async run() {
      activeSubmits += 1;
      maxActiveSubmits = Math.max(maxActiveSubmits, activeSubmits);
      const result = await withoutConsole(() => submitAll(submissionConfig, {
        fetchImpl: async () => {
          posts += 1;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
        sessionResult,
      }));
      activeSubmits -= 1;
      return { attempted: true, sent: result.sent, status: "completed", terminal: true };
    },
  });
  const monitor = monitorFor(scope, watcher, {
    onAdopted(event) {
      assert.equal(event.trigger, "score-adopted");
      submitPromise = coordinator.request(event.trigger);
      return submitPromise;
    },
  });
  monitor.start();

  for (const [index, score] of [100, 200, 300].entries()) {
    await publishAtomically(scope.stagingPendingDir, `score-${index + 1}.json`, validEvent(score));
  }
  watcher.emit();
  await monitor.requestRescan();
  await submitPromise;

  assert.equal(mameOpen, true);
  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), []);
  assert.deepEqual(await listJsonFiles(scope.sentDir), ["score-1.json", "score-2.json", "score-3.json"]);
  assert.equal(posts, 3);
  assert.equal(maxActiveSubmits, 1);
  assert.equal(monitor.getDiagnostics().liveAdopted, 3);
  mameOpen = false;
  await monitor.close();
});

test("offline capture remains durable and connectivity recovery sends it", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  let connected = false;
  let runs = 0;
  let requestPromise = Promise.resolve();
  const coordinator = createPendingAutoSubmitCoordinator({
    async inspect() {
      const pending = await listJsonFiles(scope.scopedPendingDir);
      return {
        connection: { reachability: connected ? "connected" : "offline", reachabilityGeneration: connected ? 2 : 1 },
        index: { revision: pending.join("|") || "empty", totals: { pending: pending.length } },
        playerKey: "player-a",
        session: { hasSession: true, userId: "user-a" },
        userId: "user-a",
        webBaseUrl: "https://hsl.example",
      };
    },
    async run() {
      runs += 1;
      for (const filename of await listJsonFiles(scope.scopedPendingDir)) {
        await moveFileSafe(path.join(scope.scopedPendingDir, filename), path.join(scope.sentDir, filename));
      }
      return { attempted: true, sent: 1, status: "completed", terminal: true };
    },
  });
  const monitor = monitorFor(scope, watcher, {
    onAdopted() {
      requestPromise = coordinator.request("score-adopted");
      return requestPromise;
    },
  });
  monitor.start();
  await publishAtomically(scope.stagingPendingDir, "offline.json", validEvent());
  watcher.emit();
  await monitor.requestRescan();
  const deferred = await requestPromise;

  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.deferReason, "offline");
  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), ["offline.json"]);
  assert.equal(runs, 0);

  connected = true;
  await coordinator.request("connectivity-restored");
  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), []);
  assert.deepEqual(await listJsonFiles(scope.sentDir), ["offline.json"]);
  assert.equal(runs, 1);
  await monitor.close();
});

test("guarded run adopts clean evidence and locally rejects violations without submit signal", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  const submitSignals = [];
  const monitor = monitorFor(scope, watcher, {
    competitionGuard: competitionGuard(),
    scopedRejectedDir: scope.rejectedDir,
    onAdopted(event) { submitSignals.push(event); },
  });
  monitor.start();
  await publishAtomically(scope.stagingPendingDir, "clean.json", guardedEvent([]));
  await publishAtomically(scope.stagingPendingDir, "violated.json", guardedEvent(["pause"]));
  watcher.emit();
  await monitor.requestRescan();

  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), ["clean.json"]);
  assert.deepEqual(await listJsonFiles(scope.rejectedDir), ["violated.json"]);
  assert.equal(submitSignals.length, 1);
  assert.deepEqual(submitSignals[0].adopted.map((entry) => entry.filename), ["clean.json"]);
  assert.equal(monitor.getDiagnostics().localRejected, 1);
  assert.match(await fsp.readFile(path.join(scope.rejectedDir, "violated.json.rejected.txt"), "utf8"), /LOCAL_COMPETITION_INTEGRITY[\s\S]*pause/);
  await monitor.close();
});

test("guarded run fails closed when evidence is missing or forged", async (t) => {
  const scope = await tempScope(t);
  const watcher = fakeWatcher();
  let submitSignals = 0;
  const monitor = monitorFor(scope, watcher, {
    competitionGuard: competitionGuard(),
    scopedRejectedDir: scope.rejectedDir,
    onAdopted() { submitSignals += 1; },
  });
  monitor.start();
  await publishAtomically(scope.stagingPendingDir, "missing.json", validEvent());
  await publishAtomically(scope.stagingPendingDir, "forged.json", guardedEvent([], { runId: "run-forged" }));
  watcher.emit();
  await monitor.requestRescan();

  assert.deepEqual(await listJsonFiles(scope.scopedPendingDir), []);
  assert.deepEqual(await listJsonFiles(scope.rejectedDir), ["forged.json", "missing.json"]);
  assert.equal(submitSignals, 0);
  assert.equal(monitor.getDiagnostics().localRejected, 2);
  await monitor.close();
});
