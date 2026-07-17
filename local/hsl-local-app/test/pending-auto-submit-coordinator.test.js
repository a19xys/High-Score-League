const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPendingAutoSubmitCoordinator,
  derivePendingAutoSubmitReadiness,
  pendingAutoSubmitKey,
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

test("readiness is explicit and key includes account, connection, and queue", () => {
  assert.equal(derivePendingAutoSubmitReadiness(ready()).ready, true);
  assert.equal(derivePendingAutoSubmitReadiness({ ...ready(), session: null }).reason, "session-not-ready");
  assert.equal(pendingAutoSubmitKey(ready()), "user-one:2:rev-1:0");
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
  assert.equal(coordinator.getDiagnostics().cooldownAttempt, 1);
});

test("auth blocks only the same session revision and development override bypasses guards", async () => {
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

  context = { ...context, index: { revision: "rev-2", totals: { pending: 1 } } };
  const overridden = await coordinator.request("development-force", { overrideCooldown: true });
  assert.equal(overridden.status, "completed");
});

test("invalidation cancels an in-flight result without creating a terminal key", async () => {
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
  coordinator.invalidate("account-change");
  release();
  assert.equal((await first).status, "cancelled");
  const second = coordinator.request("new-context");
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal((await second).status, "completed");
  assert.equal(runs, 2);
});
