const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  discoverPlayerPendingScopes,
  derivePlayerKey,
  buildPlayerPendingIndex,
} = require("../src/scoped-queue");
const {
  resetAutoSyncStateForTests,
  runPendingAutoSubmit,
} = require("../gui/launcher-service");

function queue(pending, sent = 0, failed = 0) {
  return {
    failed: { count: failed },
    pending: { count: pending },
    sent: { count: sent },
    totals: { failed, pending, sent },
  };
}

test("scope discovery only returns valid pending queues owned by the active account", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-auto-submit-"));
  const session = { email: "active@example.com", hasSession: true, userId: "active-user" };
  const playerKey = derivePlayerKey(session);

  async function createScope(packKey, meta, { failed = 0, pending = 0 } = {}) {
    const root = path.join(userDataDir, "players", playerKey, "packs", packKey);
    await Promise.all([
      fsp.mkdir(path.join(root, "events", "pending"), { recursive: true }),
      fsp.mkdir(path.join(root, "events", "failed"), { recursive: true }),
    ]);
    await fsp.writeFile(path.join(root, "meta.json"), JSON.stringify(meta), "utf8");
    for (let index = 0; index < pending; index += 1) {
      await fsp.writeFile(path.join(root, "events", "pending", `${index}.json`), "{}", "utf8");
    }
    for (let index = 0; index < failed; index += 1) {
      await fsp.writeFile(path.join(root, "events", "failed", `${index}.json`), "{}", "utf8");
    }
  }

  const meta = (packKey, userId = session.userId) => ({
    schemaVersion: 1,
    player: { playerKey, userId },
    pack: {
      gameId: "game",
      packKey,
      rom: "invaders",
      webBaseUrl: "https://hsl.example",
      weekId: `week-${packKey}`,
    },
  });

  try {
    await createScope("pack-one", meta("pack-one"), { pending: 1 });
    await createScope("pack-failed-only", meta("pack-failed-only"), { failed: 1 });
    await createScope("pack-other-user", meta("pack-other-user", "other-user"), { pending: 1 });
    const discovery = await discoverPlayerPendingScopes({ userDataDir }, session);
    assert.deepEqual(discovery.records.map((item) => item.scope.packKey), ["pack-one"]);
    assert.equal(discovery.records[0].pendingCount, 1);
    assert.ok(discovery.skipped.some((item) => item.reason === "user-mismatch"));
  } finally {
    await fsp.rm(userDataDir, { force: true, recursive: true });
  }
});

test("auto submit processes multiple scopes sequentially through submitAll", async () => {
  resetAutoSyncStateForTests();
  const session = { email: "active@example.com", hasSession: true, userId: "active-user" };
  const playerKey = derivePlayerKey(session);
  const records = ["pack-one", "pack-two"].map((packKey, index) => ({
    meta: {
      pack: { packKey, webBaseUrl: "https://hsl.example", weekId: `week-${index + 1}` },
      player: { playerKey, userId: session.userId },
      schemaVersion: 1,
    },
    pendingCount: index + 1,
    scope: {
      eventsRoot: `/${packKey}/events`,
      packKey,
      playerKey,
      scopedFailedDir: `/${packKey}/events/failed`,
      scopedPendingDir: `/${packKey}/events/pending`,
      scopedQueueRoot: `/${packKey}`,
      scopedSentDir: `/${packKey}/events/sent`,
    },
  }));
  const queues = new Map(records.map((record) => [record.scope.packKey, queue(record.pendingCount)]));
  const order = [];
  const result = await runPendingAutoSubmit({
    checkMembershipImpl: async () => ({ canSubmit: true, status: "member" }),
    config: { sessionFileAbs: "/active-session.json", userDataDir: "/user-data" },
    connectedGeneration: 4,
    discoverScopesImpl: async () => ({ playerKey, records, skipped: [] }),
    getAuthStateImpl: async () => session,
    getQueueStateImpl: async (config) => queues.get(config.scopedQueue.packKey),
    getSessionPathImpl: () => "/account-session.json",
    shouldContinue: () => true,
    submitAllImpl: async (config) => {
      const packKey = config.scopedQueue.packKey;
      order.push(packKey);
      const before = queues.get(packKey);
      queues.set(packKey, queue(0, before.totals.sent + before.totals.pending));
    },
    trigger: "connectivity-restored",
  });
  assert.deepEqual(order, ["pack-one", "pack-two"]);
  assert.equal(result.sent, 3);
  assert.equal(result.preserved, 0);
  assert.equal(result.diagnostics.connectedGeneration, 4);
  assert.match(result.diagnostics.user, /^player_[a-f0-9]{12}$/);
});

test("main coordinator uses queue revision and updates renderer silently", async () => {
  const [main, preload, renderer] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "preload.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8"),
  ]);
  assert.match(main, /createPendingAutoSubmitCoordinator/);
  assert.match(main, /getPendingAutoSubmitContext/);
  assert.match(main, /runPendingAutoSubmit/);
  assert.match(main, /invalidatePendingAutoSubmit\("shutdown"\)/);
  assert.match(preload, /onLauncherState/);
  assert.match(renderer, /applyBackgroundLauncherState/);
  assert.doesNotMatch(main, /attemptAutoSync: true/);
});

test("queue index revision is stable and changes when pending changes", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-queue-index-"));
  const session = { hasSession: true, userId: "active-user" };
  const playerKey = derivePlayerKey(session);
  const packKey = "pack-one";
  const root = path.join(userDataDir, "players", playerKey, "packs", packKey);
  const pending = path.join(root, "events", "pending");
  await fsp.mkdir(pending, { recursive: true });
  await fsp.writeFile(path.join(root, "meta.json"), JSON.stringify({
    schemaVersion: 1,
    player: { playerKey, userId: session.userId },
    pack: { gameId: "game", packKey, rom: "invaders", webBaseUrl: "https://hsl.example", weekId: "week-one" },
  }));
  try {
    const first = await buildPlayerPendingIndex({ userDataDir }, session);
    const same = await buildPlayerPendingIndex({ userDataDir }, session);
    assert.equal(first.revision, same.revision);
    await fsp.writeFile(path.join(pending, "new.json"), "{}");
    const changed = await buildPlayerPendingIndex({ userDataDir }, session);
    assert.notEqual(first.revision, changed.revision);
    assert.equal(changed.totals.pending, 1);
    assert.equal(changed.totals.validPending, 0);
  } finally {
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }
});

test("membership transport and auth failures preserve pending and stop the cycle", async () => {
  const session = { hasSession: true, userId: "active-user" };
  const playerKey = derivePlayerKey(session);
  const record = {
    meta: {
      pack: { packKey: "pack-one", webBaseUrl: "https://hsl.example", weekId: "week-one" },
      player: { playerKey, userId: session.userId },
      schemaVersion: 1,
    },
    pendingCount: 2,
    scope: {
      eventsRoot: "/pack-one/events",
      packKey: "pack-one",
      playerKey,
      scopedFailedDir: "/pack-one/events/failed",
      scopedPendingDir: "/pack-one/events/pending",
      scopedQueueRoot: "/pack-one",
      scopedSentDir: "/pack-one/events/sent",
    },
  };
  const base = {
    config: { userDataDir: "/user-data" },
    discoverScopesImpl: async () => ({ playerKey, records: [record], skipped: [] }),
    getAuthStateImpl: async () => session,
    getSessionPathImpl: () => "/account-session.json",
    shouldContinue: () => true,
    submitAllImpl: async () => assert.fail("submit must not run"),
  };

  resetAutoSyncStateForTests();
  const transport = await runPendingAutoSubmit({
    ...base,
    checkMembershipImpl: async () => ({ request: { url: "https://hsl.example/api" }, status: "unknown" }),
  });
  assert.equal(transport.transportFailure, true);
  assert.equal(transport.preserved, 2);

  resetAutoSyncStateForTests();
  const auth = await runPendingAutoSubmit({
    ...base,
    checkMembershipImpl: async () => ({ status: "unauthenticated" }),
  });
  assert.equal(auth.authFailure, true);
  assert.equal(auth.preserved, 2);
});
