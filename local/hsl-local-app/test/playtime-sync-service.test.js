const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlayTimeSyncService } = require("../src/playtime-sync-service");

function harness({ accounts = ["a"], remote }) {
  const boxes = new Map(accounts.map((id) => [`user_${id}`, [{ eventId: `${id}1111111-1111-4111-8111-111111111111` }]]));
  const acknowledged = [];
  const rejected = [];
  const service = createPlayTimeSyncService({
    config: { userDataDir: "C:/tmp", webBaseUrl: "https://example.test" },
    createStoreImpl: (_config, playerKey) => ({
      acknowledge: async (id) => { acknowledged.push([playerKey, id]); boxes.set(playerKey, []); },
      listPending: async () => boxes.get(playerKey) || [],
      reject: async (id) => { rejected.push([playerKey, id]); boxes.set(playerKey, []); },
    }),
    getConnectivityState: () => ({ reachability: "connected" }),
    postEventImpl: remote,
    readKnownAccountsImpl: async () => ({ accounts: accounts.map((userId) => ({ userId })) }),
    resolveSessionResultImpl: async (_config, { userId }) => ({
      remoteUsable: true,
      requiresLogin: false,
      storedSession: { session: { access_token: `token-${userId}` } },
    }),
  });
  return { acknowledged, boxes, rejected, service };
}

test("NEW and DUPLICATE ACK silently while multi-account stays isolated", async () => {
  const seen = [];
  const h = harness({ accounts: ["a", "b"], remote: async ({ accessToken }) => {
    seen.push(accessToken);
    return { ok: true, duplicate: accessToken.endsWith("b") };
  } });
  const first = h.service.request("startup");
  const second = h.service.request("connectivity-restored");
  assert.equal(first, second);
  const result = await first;
  assert.equal(result.acknowledged, 2);
  assert.deepEqual(seen, ["token-a", "token-b"]);
  assert.deepEqual(h.acknowledged.map(([key]) => key), ["user_a", "user_b"]);
});

test("retryable transport, timeout, throttling, server and auth outcomes preserve pending", async () => {
  for (const failureType of ["transport-failure", "timeout", "throttled", "server", "auth"]) {
    const h = harness({ remote: async () => ({ failureType, httpStatus: failureType === "throttled" ? 429 : 500, ok: false, terminal: false }) });
    const result = await h.service.request(failureType);
    assert.equal(result.preserved, 1, failureType);
    assert.equal(h.acknowledged.length, 0);
    assert.equal(h.rejected.length, 0);
  }
});

test("terminal 4xx moves event to internal failed and offline/auth-deferred do not send", async () => {
  const terminal = harness({ remote: async () => ({ httpStatus: 400, ok: false, terminal: true }) });
  assert.equal((await terminal.service.request("terminal")).failedTerminal, 1);
  assert.equal(terminal.rejected.length, 1);

  let calls = 0;
  const deferred = createPlayTimeSyncService({
    config: { userDataDir: "C:/tmp", webBaseUrl: "https://example.test" },
    createStoreImpl: () => ({ listPending: async () => [{ eventId: "x" }] }),
    getConnectivityState: () => ({ reachability: "connected" }),
    postEventImpl: async () => { calls += 1; },
    readKnownAccountsImpl: async () => ({ accounts: [{ userId: "a" }] }),
    resolveSessionResultImpl: async () => ({ remoteUsable: false, requiresLogin: false, storedSession: null }),
  });
  assert.equal((await deferred.request("deferred")).preserved, 1);
  assert.equal(calls, 0);
  deferred.cancel();

  const offline = createPlayTimeSyncService({ getConnectivityState: () => ({ reachability: "offline" }) });
  assert.deepEqual(await offline.request("offline"), { attempted: false, reason: "offline" });
});

test("a cancelled stale response cannot ACK and a later run remains authoritative", async () => {
  let release;
  const remote = new Promise((resolve) => { release = resolve; });
  const h = harness({ remote: async () => remote });
  const old = h.service.request("old");
  await new Promise((resolve) => setImmediate(resolve));
  h.service.cancel("external-abort");
  release({ ok: true, duplicate: false });
  await old;
  assert.equal(h.acknowledged.length, 0);

  assert.equal((await h.service.request("new")).acknowledged, 1);
});
