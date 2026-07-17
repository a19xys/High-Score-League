const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPendingAutoSubmitCoordinator,
  derivePendingAutoSubmitReadiness,
  pendingAutoSubmitExecutionKey,
  pendingAutoSubmitGuardKey,
} = require("../src/pending-auto-submit-coordinator");

function ready(revision = "rev-1") {
  return {
    connection: { reachability: "connected", reachabilityGeneration: 2 },
    index: { revision, totals: { pending: 1 } },
    playerKey: "player-one",
    session: { hasSession: true, userId: "user-one" },
    userId: "user-one",
    webBaseUrl: "https://hsl.example",
  };
}

test("readiness and stable guard identity separate queue/session from connectivity generation", () => {
  assert.equal(derivePendingAutoSubmitReadiness(ready()).ready, true);
  assert.equal(derivePendingAutoSubmitReadiness({ ...ready(), session: null }).reason, "session-not-ready");
  assert.equal(pendingAutoSubmitGuardKey(ready()), "user-one:rev-1:0");
  assert.equal(pendingAutoSubmitExecutionKey(ready()), "user-one:rev-1:0:2");
});

test("deferred startup does not consume the opportunity and new revision retriggers", async () => {
  let context = { ...ready(), session: null };
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => context,
    run: async () => { runs += 1; return { attempted: true, sent: 1, terminal: true }; },
  });
  assert.equal((await coordinator.request("startup")).status, "deferred");
  context = ready();
  await coordinator.request("state-ready");
  await coordinator.request("duplicate");
  assert.equal(runs, 1);
  context = ready("rev-2");
  await coordinator.request("capture");
  assert.equal(runs, 2);
});

test("transport and lock deferrals remain retryable", async () => {
  let result = { attempted: false, reason: "sync-in-progress" };
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => ready(),
    run: async () => { runs += 1; return result; },
  });
  assert.equal((await coordinator.request("startup")).status, "deferred");
  result = { attempted: true, sent: 1 };
  await coordinator.request("manual-finished");
  assert.equal(runs, 2);
});

test("retryable results use bounded cooldown and Retry-After without consuming the key", async () => {
  let clock = Date.parse("2026-07-17T00:00:00Z");
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => ready(),
    now: () => clock,
    run: async () => {
      runs += 1;
      return runs === 1
        ? { attempted: true, retryAfterMs: 60000, retryable: true, status: "deferred", terminal: false }
        : { attempted: true, sent: 1, status: "completed", terminal: true };
    },
  });
  assert.equal((await coordinator.request("startup")).status, "deferred");
  const cooled = await coordinator.request("maintenance");
  assert.equal(cooled.reason, "cooldown");
  assert.equal(cooled.retryAfterMs, 60000);
  assert.equal(runs, 1);
  clock += 60000;
  assert.equal((await coordinator.request("maintenance")).status, "completed");
  assert.equal(runs, 2);
  assert.equal(coordinator.getDiagnostics().cooldownAttempt, 0);
  assert.equal(coordinator.getDiagnostics().retryAttempt, 0);
});

test("auth blocks only the same session revision and explicit development reset bypasses guards", async () => {
  let context = { ...ready(), sessionRevision: 7 };
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => context,
    run: async () => {
      runs += 1;
      return runs === 1
        ? { attempted: true, authFailure: true, status: "deferred", terminal: false }
        : { attempted: true, status: "completed", terminal: true };
    },
  });
  await coordinator.request("startup");
  assert.equal((await coordinator.request("maintenance")).reason, "auth-required");
  assert.equal(runs, 1);
  context = { ...context, sessionRevision: 8 };
  assert.equal((await coordinator.request("session-refresh")).status, "completed");
  assert.equal(runs, 2);

  coordinator.resetGuards("development-force");
  const overridden = await coordinator.request("development-force");
  assert.equal(overridden.status, "completed");
  assert.equal(coordinator.getDiagnostics().lastGuardResetReason, "development-force");
});

test("cancellation stops an in-flight result without creating a terminal key", async () => {
  let release;
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => ready(),
    run: async () => {
      runs += 1;
      await new Promise((resolve) => { release = resolve; });
      return { attempted: true, status: "completed", terminal: true };
    },
  });
  const first = coordinator.request("startup");
  await new Promise((resolve) => setImmediate(resolve));
  coordinator.cancelCurrentRun("account-change");
  release();
  assert.equal((await first).status, "cancelled");
  const second = coordinator.request("new-context");
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal((await second).status, "completed");
  assert.equal(runs, 2);
});

test("429 cooldown survives a new reachability generation with exact remaining Retry-After", async () => {
  let clock = Date.parse("2026-07-17T00:00:00Z");
  let context = ready();
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => context,
    now: () => clock,
    run: async () => {
      runs += 1;
      return { attempted: true, retryAfterMs: 900000, retryable: true, status: "deferred", terminal: false };
    },
  });
  await coordinator.request("startup");
  clock += 120000;
  context = { ...context, connection: { ...context.connection, reachabilityGeneration: 3 } };
  const deferred = await coordinator.request("connectivity-restored");
  assert.equal(runs, 1);
  assert.equal(deferred.reason, "cooldown");
  assert.equal(deferred.retryAfterMs, 780000);
  assert.equal(coordinator.getDiagnostics().cooldownPreservedAcrossConnectivity, true);
});

test("503 backoff survives offline/online and retries once after the deadline", async () => {
  let clock = Date.parse("2026-07-17T00:00:00Z");
  let context = ready();
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => context,
    now: () => clock,
    run: async () => {
      runs += 1;
      return runs === 1
        ? { attempted: true, retryable: true, status: "deferred", terminal: false }
        : { attempted: true, status: "completed", terminal: true };
    },
  });
  await coordinator.request("startup");
  context = { ...context, connection: { reachability: "offline", reachabilityGeneration: 3 } };
  assert.equal((await coordinator.request("offline")).deferReason, "offline");
  context = { ...context, connection: { reachability: "connected", reachabilityGeneration: 4 } };
  assert.equal((await coordinator.request("connectivity-restored")).reason, "cooldown");
  assert.equal(runs, 1);
  clock += 30000;
  assert.equal((await coordinator.request("maintenance")).status, "completed");
  assert.equal(runs, 2);
});

test("suspend cancellation preserves cooldown and auth block across resume", async () => {
  let clock = Date.parse("2026-07-17T00:00:00Z");
  let context = ready();
  let mode = "cooldown";
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => context,
    now: () => clock,
    run: async () => {
      runs += 1;
      return mode === "cooldown"
        ? { retryAfterMs: 900000, retryable: true, status: "deferred", terminal: false }
        : { authFailure: true, status: "deferred", terminal: false };
    },
  });
  await coordinator.request("startup");
  const nextEligibleAt = coordinator.getDiagnostics().nextEligibleAt;
  coordinator.cancelCurrentRun("suspend");
  clock += 180000;
  context = { ...context, connection: { reachability: "connected", reachabilityGeneration: 3 } };
  const resumed = await coordinator.request("resume");
  assert.equal(resumed.reason, "cooldown");
  assert.equal(resumed.retryAfterMs, 720000);
  assert.equal(coordinator.getDiagnostics().nextEligibleAt, nextEligibleAt);
  clock += 720000;
  mode = "auth";
  await coordinator.request("maintenance");
  coordinator.cancelCurrentRun("suspend");
  context = { ...context, connection: { reachability: "connected", reachabilityGeneration: 4 } };
  assert.equal((await coordinator.request("resume")).reason, "auth-required");
  assert.equal(coordinator.getDiagnostics().authBlockPreservedAcrossConnectivity, true);
  context = { ...context, sessionRevision: 1 };
  mode = "cooldown";
  await coordinator.request("session-refreshed");
  assert.equal(runs, 3);
});

test("queue revision creates new work while terminality survives reconnect", async () => {
  let context = ready();
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => context,
    run: async () => { runs += 1; return { status: "completed", terminal: true }; },
  });
  await coordinator.request("startup");
  context = { ...context, connection: { reachability: "connected", reachabilityGeneration: 9 } };
  assert.equal((await coordinator.request("reconnected")).reason, "already-completed");
  assert.equal(runs, 1);
  context = ready("rev-2");
  await coordinator.request("new-queue");
  assert.equal(runs, 2);
});

test("cancelCurrentRun preserves guards while resetGuards clears them explicitly", async () => {
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => ready(),
    run: async () => {
      runs += 1;
      return { retryAfterMs: 60000, retryable: true, status: "deferred", terminal: false };
    },
  });
  await coordinator.request("startup");
  const before = coordinator.getDiagnostics().nextEligibleAt;
  coordinator.cancelCurrentRun("suspend");
  assert.equal(coordinator.getDiagnostics().nextEligibleAt, before);
  assert.equal((await coordinator.request("resume")).reason, "cooldown");
  coordinator.resetGuards("test-reset");
  await coordinator.request("after-reset");
  assert.equal(runs, 2);
  assert.equal(coordinator.getDiagnostics().lastGuardResetReason, "test-reset");
  assert.match(coordinator.getDiagnostics().guardKey, /^guard_[a-f0-9]{12}$/);
  assert.equal(coordinator.getDiagnostics().guardKey.includes("user-one"), false);
});

test("session refresh deferral consumes neither auth block, terminal key nor submission cooldown", async () => {
  let runs = 0;
  const coordinator = createPendingAutoSubmitCoordinator({
    inspect: async () => ready(),
    run: async () => {
      runs += 1;
      return {
        reason: "refresh-backoff",
        sessionDeferred: true,
        status: "deferred",
        terminal: false,
      };
    },
  });
  const first = await coordinator.request("startup");
  const second = await coordinator.request("maintenance");
  assert.equal(first.status, "deferred");
  assert.equal(second.status, "deferred");
  assert.equal(runs, 2);
  assert.equal(coordinator.getDiagnostics().authBlocked, false);
  assert.equal(coordinator.getDiagnostics().nextEligibleAt, null);
  assert.equal(coordinator.getDiagnostics().lastTerminalKey, null);
});
