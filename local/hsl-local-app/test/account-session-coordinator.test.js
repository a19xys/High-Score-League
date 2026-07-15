const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccountSessionCoordinator } = require("../src/account-session-coordinator");

function stored(userId = "user-1", expiresAt = 100) {
  return { user: { id: userId }, session: { access_token: "a", refresh_token: "r", expires_at: expiresAt } };
}

test("session refresh is single-flight per account and advances revision", async () => {
  let refreshCalls = 0;
  let resolveRefresh;
  let current = stored();
  let revision = 1;
  const coordinator = createAccountSessionCoordinator({
    isExpiringSoon: () => true,
    readSession: async () => ({ ok: true, revision, session: current, storage: { provider: "test" } }),
    refreshSession: () => {
      refreshCalls += 1;
      return new Promise((resolve) => { resolveRefresh = () => { current = stored("user-1", 500); revision = 2; resolve(current); }; });
    },
  });
  const account = { userId: "user-1" };
  const first = coordinator.resolve(account, {}, { connected: true });
  const second = coordinator.resolve(account, {}, { connected: true });
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  resolveRefresh();
  const result = await first;
  assert.equal(refreshCalls, 1);
  assert.equal(result.status, "valid");
  assert.equal(result.sessionRevision, 2);
});

test("temporary refresh failure preserves session while revocation is conclusive", async () => {
  const account = { userId: "user-1" };
  const base = {
    isExpiringSoon: () => true,
    readSession: async () => ({ ok: true, revision: 1, session: stored(), storage: {} }),
  };
  const temporary = createAccountSessionCoordinator({
    ...base,
    refreshSession: async () => { throw Object.assign(new Error("offline"), { transient: true, sessionStatus: "temporary-failure" }); },
  });
  const deferred = await temporary.resolve(account, {}, { connected: true });
  assert.equal(deferred.status, "deferred-offline");
  assert.equal(deferred.storedSession.user.id, "user-1");

  const revoked = createAccountSessionCoordinator({
    ...base,
    refreshSession: async () => { throw Object.assign(new Error("revoked"), { code: "refresh-token-rejected", sessionStatus: "revoked" }); },
  });
  const rejected = await revoked.resolve(account, {}, { connected: true });
  assert.equal(rejected.status, "revoked");
  assert.equal(rejected.storedSession, null);
});

test("offline defers refresh without making a network request", async () => {
  let refreshCalls = 0;
  const coordinator = createAccountSessionCoordinator({
    isExpiringSoon: () => true,
    readSession: async () => ({ ok: true, revision: 1, session: stored(), storage: {} }),
    refreshSession: async () => { refreshCalls += 1; },
  });
  const result = await coordinator.resolve({ userId: "user-1" }, {}, { connected: false });
  assert.equal(result.status, "deferred-offline");
  assert.equal(refreshCalls, 0);
});

test("session diagnostics attach pending counts without exposing the session", async () => {
  const coordinator = createAccountSessionCoordinator({
    isExpiringSoon: () => false,
    readSession: async () => ({ ok: true, revision: 3, session: stored(), storage: {} }),
  });

  await coordinator.resolve({ userId: "user-1" }, {}, { connected: true });
  coordinator.setPendingCount("user-1", 2);

  assert.equal(coordinator.getState("user-1").pendingCount, 2);
  assert.equal(coordinator.getDiagnostics()[0].storedSession, undefined);
});
