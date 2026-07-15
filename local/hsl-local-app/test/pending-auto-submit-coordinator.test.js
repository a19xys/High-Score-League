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
    run: async () => { runs += 1; return { attempted: true, sent: 1 }; },
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
