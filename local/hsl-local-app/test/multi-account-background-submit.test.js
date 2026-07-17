const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  rememberAccount,
  saveRememberedSession,
} = require("../src/account-store");
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
    userDataDir,
    webBaseUrl: "https://hsl.example",
  };
  try {
    await rememberAccount(config, { userId: "user-a", email: "a@example.com" });
    await saveRememberedSession(config, stored("user-a"));
    await rememberAccount(config, { userId: "user-b", email: "b@example.com" });
    await saveRememberedSession(config, stored("user-b"));
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
