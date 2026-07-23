const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAccountSessionRepository } = require("../src/account-session-repository");
const { rememberAccount } = require("../src/account-store");
const { createPendingAutoSubmitCoordinator } = require("../src/pending-auto-submit-coordinator");
const { derivePlayerKey } = require("../src/scoped-queue");
const { createSessionResult } = require("../src/session-result");
const {
  getPendingAutoSubmitContexts,
  runPendingAutoSubmitForAccounts,
} = require("../gui/launcher-service");

function stored(userId) {
  return {
    schemaVersion: 1,
    user: { id: userId, email: `${userId}@example.com` },
    session: {
      access_token: `access-${userId}`,
      refresh_token: `refresh-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

test("remembered inactive account keeps an independent eligible session", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-multi-account-"));
  const config = {
    eventsPendingDirAbs: path.join(userDataDir, "events", "pending"),
    sessionFileAbs: path.join(userDataDir, "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    userDataDir,
    webBaseUrl: "https://hsl.example",
  };
  try {
    const repository = createAccountSessionRepository({
      config,
      isExpiringSoon: () => false,
      refreshProvider: async ({ storedSession }) => storedSession,
    });
    await repository.saveLogin(stored("user-a"), { setActive: false });
    await repository.saveLogin(stored("user-b"));
    const result = await getPendingAutoSubmitContexts({
      activeUserId: "user-b",
      config,
      connection: { reachability: "connected", reachabilityGeneration: 3 },
    });
    assert.deepEqual(result.accountContexts.map((item) => item.userId), ["user-b", "user-a"]);
    assert.equal(result.accountContexts[0].active, true);
    assert.equal(result.accountContexts[1].session.userId, "user-a");
  } finally {
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }
});

test("multi-account submit is sequential and never crosses account identity", async () => {
  const order = [];
  const contexts = ["user-b", "user-a"].map((userId) => ({
    config: {},
    index: { totals: { pending: 1 } },
    session: { hasSession: true, userId },
  }));
  const result = await runPendingAutoSubmitForAccounts({
    accountContexts: contexts,
    connectedGeneration: 4,
    runAccountImpl: async (options) => {
      order.push(options.session.userId);
      return { attempted: true, failed: 0, preserved: 0, sent: 1, transportFailure: false };
    },
    shouldContinue: () => true,
  });
  assert.deepEqual(order, ["user-b", "user-a"]);
  assert.equal(result.sent, 2);
  assert.equal(result.processedAccounts, 2);
});

test("auth failure in one account does not prevent a later account from submitting", async () => {
  const order = [];
  const contexts = ["user-a", "user-b"].map((userId) => ({
    config: {},
    index: { totals: { pending: 1 } },
    session: { hasSession: true, userId },
  }));
  const result = await runPendingAutoSubmitForAccounts({
    accountContexts: contexts,
    runAccountImpl: async ({ session }) => {
      order.push(session.userId);
      return session.userId === "user-a"
        ? { attempted: true, authFailure: true, preserved: 1, sent: 0, status: "deferred", terminal: false }
        : { attempted: true, preserved: 0, sent: 1, status: "completed", terminal: true };
    },
    shouldContinue: () => true,
  });
  assert.deepEqual(order, ["user-a", "user-b"]);
  assert.equal(result.authFailure, true);
  assert.equal(result.sent, 1);
  assert.equal(result.preserved, 1);
  assert.equal(result.status, "deferred");
  assert.equal(result.terminal, false);
});

test("canonical remote usability admits refreshed and usable deferred sessions only", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-session-eligibility-"));
  const config = {
    eventsPendingDirAbs: path.join(userDataDir, "events", "pending"),
    sessionFileAbs: path.join(userDataDir, "session.json"),
    userDataDir,
    webBaseUrl: "https://hsl.example",
  };
  const statuses = new Map([
    ["refreshed", createSessionResult({ status: "refreshed", sessionRevision: 2, storedSession: stored("refreshed") })],
    ["deferred-usable", createSessionResult({ status: "deferred", remoteUsable: true, sessionRevision: 3, storedSession: stored("deferred-usable") })],
    ["deferred-expired", createSessionResult({ status: "deferred", remoteUsable: false, sessionRevision: 4, storedSession: stored("deferred-expired") })],
    ["provider-mismatch", createSessionResult({ status: "provider-mismatch", sessionRevision: 5, storedSession: stored("provider-mismatch") })],
  ]);
  try {
    for (const userId of statuses.keys()) await rememberAccount(config, { userId }, { setActive: false });
    const result = await getPendingAutoSubmitContexts({
      config,
      connection: { reachability: "connected", reachabilityGeneration: 1 },
      resolveSessionResultImpl: async (_config, options) => statuses.get(options.userId),
    });

    assert.deepEqual(new Set(result.accountContexts.map((item) => item.userId)), new Set(["refreshed", "deferred-usable"]));
    assert.equal(result.accounts.find((item) => item.status === "refreshed").remoteUsable, true);
    assert.equal(result.accounts.find((item) => item.status === "provider-mismatch").remoteUsable, false);
  } finally {
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }
});

test("session-deferred aggregation creates no auth block, terminal key or submission cooldown", async () => {
  const contexts = [];
  Object.defineProperty(contexts, "sessionSummary", {
    value: { loginRequiredPendingCount: 0, sessionDeferredPendingCount: 1, unavailablePendingCount: 0 },
  });
  const aggregate = await runPendingAutoSubmitForAccounts({ accountContexts: contexts });
  assert.equal(aggregate.authFailure, false);
  assert.equal(aggregate.retryable, false);
  assert.equal(aggregate.sessionDeferred, true);
  assert.equal(aggregate.status, "auth-deferred");
  assert.equal(aggregate.terminal, false);

  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => ({
      connection: { reachability: "connected", reachabilityGeneration: 1 },
      index: { revision: "queue-1", totals: { pending: 1 } },
      playerKey: "player-one",
      session: { hasSession: true, userId: "user-one" },
      sessionRevision: 1,
      userId: "user-one",
      webBaseUrl: "https://hsl.example",
    }),
    run: async () => aggregate,
  });
  await coordinator.request("session-maintenance");
  const diagnostics = coordinator.getDiagnostics();
  assert.equal(diagnostics.authBlocked, false);
  assert.equal(diagnostics.lastTerminalKey, null);
  assert.equal(diagnostics.nextEligibleAt, null);
});

test("a session that becomes unusable during one account run does not block another account", async () => {
  const contexts = ["user-a", "user-b"].map((userId) => ({
    config: {},
    index: { totals: { pending: 1 } },
    session: { hasSession: true, userId },
  }));
  const order = [];
  const aggregate = await runPendingAutoSubmitForAccounts({
    accountContexts: contexts,
    runAccountImpl: async ({ session }) => {
      order.push(session.userId);
      return session.userId === "user-a"
        ? { attempted: false, preserved: 1, sent: 0, sessionDeferred: true, status: "auth-deferred", terminal: false }
        : { attempted: true, preserved: 0, sent: 1, status: "completed", terminal: true };
    },
    shouldContinue: () => true,
  });

  assert.deepEqual(order, ["user-a", "user-b"]);
  assert.equal(aggregate.sent, 1);
  assert.equal(aggregate.preserved, 1);
  assert.equal(aggregate.sessionDeferred, true);
  assert.equal(aggregate.retryable, false);
  assert.equal(aggregate.status, "auth-deferred");
  assert.equal(aggregate.terminal, false);
});

test("main-style state events, canonical account discovery and the coordinator share one deferred retry", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-main-session-retry-"));
  const userId = "user-main";
  const playerKey = derivePlayerKey({ hasSession: true, userId });
  const queueRoot = path.join(userDataDir, "players", playerKey, "packs", "pack-main");
  const pendingDir = path.join(queueRoot, "events", "pending");
  const config = {
    eventsPendingDirAbs: path.join(userDataDir, "events", "pending"),
    sessionFileAbs: path.join(userDataDir, "session.json"),
    userDataDir,
    webBaseUrl: "https://hsl.example",
  };
  let clock = Date.parse("2026-07-17T00:00:00Z");
  let timerId = 0;
  const timers = new Map();
  let refreshed = false;
  let remoteRuns = 0;
  const deferred = () => createSessionResult({
    retryAfterMs: 10000,
    sessionRevision: 1,
    status: "deferred",
    storedSession: stored(userId),
  });
  const usable = () => createSessionResult({
    sessionRevision: 2,
    status: "refreshed",
    storedSession: stored(userId),
  });

  try {
    await rememberAccount(config, { email: `${userId}@example.com`, userId });
    await fsp.mkdir(pendingDir, { recursive: true });
    await fsp.writeFile(path.join(queueRoot, "meta.json"), JSON.stringify({
      pack: {
        gameId: "game",
        packKey: "pack-main",
        webBaseUrl: "https://hsl.example",
        weekId: "week-main",
      },
      player: { playerKey, userId },
      schemaVersion: 1,
    }));
    await fsp.writeFile(path.join(pendingDir, "score.json"), "{}");

    const inspect = () => getPendingAutoSubmitContexts({
      activeUserId: userId,
      config,
      connection: { reachability: "connected", reachabilityGeneration: 1 },
      resolveSessionResultImpl: async () => refreshed ? usable() : deferred(),
    });
    const coordinator = createPendingAutoSubmitCoordinator({
      autoScheduleSessionRetry: true,
      clearTimeoutImpl: (id) => timers.delete(id),
      inspect,
      now: () => clock,
      run: (context) => runPendingAutoSubmitForAccounts({
        accountContexts: context.accountContexts,
        runAccountImpl: async () => {
          remoteRuns += 1;
          return { attempted: true, preserved: 0, sent: 1, status: "completed", terminal: true };
        },
        shouldContinue: () => true,
      }),
      setTimeoutImpl(fn, delay) {
        const id = ++timerId;
        timers.set(id, { at: clock + delay, fn });
        return id;
      },
    });

    const firstContext = await inspect();
    assert.equal(firstContext.sessionDeferrals.length, 1, JSON.stringify(firstContext.accounts));
    await coordinator.request("startup");
    await coordinator.request("launcher-state");
    await coordinator.request("session-maintenance");
    assert.equal(remoteRuns, 0);
    assert.equal(timers.size, 1);

    refreshed = true;
    clock += 10000;
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock);
    for (const [id, timer] of due) {
      timers.delete(id);
      timer.fn();
    }
    await coordinator.request("timer-drain");
    assert.equal(remoteRuns, 1);
    assert.equal(timers.size, 0);
  } finally {
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }
});
