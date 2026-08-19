const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlayTimeSyncService } = require("../src/playtime-sync-service");

function harness({ accounts = ["a"], remote }) {
  const boxes = new Map(accounts.map((id) => [`user_${id}`, [{
    eventId: `${id}1111111-1111-4111-8111-111111111111`,
    gameKey: `game-${id}`,
  }]]));
  const acknowledged = [];
  const listCalls = [];
  const rejected = [];
  const service = createPlayTimeSyncService({
    config: { userDataDir: "C:/tmp", webBaseUrl: "https://example.test" },
    createStoreImpl: (_config, playerKey) => ({
      acknowledge: async (id) => {
        acknowledged.push([playerKey, id]);
        boxes.set(playerKey, (boxes.get(playerKey) || []).filter((event) => event.eventId !== id));
      },
      listPending: async () => {
        listCalls.push(playerKey);
        return [...(boxes.get(playerKey) || [])];
      },
      reject: async (id) => {
        rejected.push([playerKey, id]);
        boxes.set(playerKey, (boxes.get(playerKey) || []).filter((event) => event.eventId !== id));
      },
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
  return { acknowledged, boxes, listCalls, rejected, service };
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
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
  assert.deepEqual(h.listCalls, ["user_a", "user_b"]);
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

test("mame-close queues one follow-up that re-enumerates pending after the active snapshot", async () => {
  const firstPost = deferred();
  const secondAck = deferred();
  const timeline = [];
  const pending = [{ eventId: "event-a", gameKey: "space-invaders" }];
  let activePosts = 0;
  let maxActivePosts = 0;
  const sent = [];
  const acknowledged = [];
  let listCount = 0;
  const service = createPlayTimeSyncService({
    config: { webBaseUrl: "https://example.test" },
    createStoreImpl: () => ({
      acknowledge: async (eventId) => {
        timeline.push(`ack:${eventId}`);
        acknowledged.push(eventId);
        const index = pending.findIndex((event) => event.eventId === eventId);
        if (index >= 0) pending.splice(index, 1);
        if (eventId === "event-b") secondAck.resolve();
      },
      listPending: async () => {
        listCount += 1;
        timeline.push(`list:${pending.map((event) => event.eventId).join(",")}`);
        return [...pending];
      },
      reject: async () => {},
    }),
    getConnectivityState: () => ({ reachability: "connected" }),
    postEventImpl: async ({ event }) => {
      activePosts += 1;
      maxActivePosts = Math.max(maxActivePosts, activePosts);
      sent.push(event.eventId);
      timeline.push(`post:${event.eventId}`);
      const response = event.eventId === "event-a"
        ? await firstPost.promise
        : { body: { gameTotalSeconds: 3180, totalSeconds: 9000 }, ok: true };
      activePosts -= 1;
      return response;
    },
    readKnownAccountsImpl: async () => ({ accounts: [{ userId: "player" }] }),
    resolveSessionResultImpl: async () => ({
      remoteUsable: true,
      storedSession: { session: { access_token: "secret" } },
    }),
  });

  const first = service.request("startup");
  await new Promise((resolve) => setImmediate(resolve));
  pending.push({ eventId: "event-b", gameKey: "space-invaders" });
  assert.equal(service.request("mame-close", { ensureFollowUp: true }), first);
  assert.equal(service.request("mame-close", { ensureFollowUp: true }), first);
  assert.equal(service.request("mame-close", { ensureFollowUp: true }), first);
  assert.equal(service.getDiagnostics().followUpQueued, true);

  firstPost.resolve({ body: { gameTotalSeconds: 2820, totalSeconds: 8640 }, ok: true });
  await first;
  await secondAck.promise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, ["event-a", "event-b"]);
  assert.deepEqual(acknowledged, ["event-a", "event-b"]);
  assert.equal(listCount, 2);
  assert.equal(maxActivePosts, 1);
  assert.ok(timeline.indexOf("ack:event-a") < timeline.indexOf("list:event-b"));
  assert.deepEqual(service.getDiagnostics(), {
    acknowledged: 2,
    cancelled: 0,
    failedTerminal: 0,
    followUpCoalesced: 2,
    followUpQueued: false,
    followUpRequests: 3,
    followUpRuns: 1,
    inFlight: false,
    lastRemoteGameKey: "space-invaders",
    lastRemoteGameTotalSeconds: 3180,
    lastRemoteTotalSeconds: 9000,
    lastRunAt: service.getDiagnostics().lastRunAt,
    lastSuccessfulAckAt: service.getDiagnostics().lastSuccessfulAckAt,
    lastTrigger: "mame-close",
    pendingVisited: 2,
    preserved: 0,
    queued: false,
    retryNotBefore: null,
    skippedAccounts: 0,
    skippedBackoff: 0,
    skippedOffline: 0,
  });
  assert.match(service.getDiagnostics().lastSuccessfulAckAt, /^\d{4}-/);
});

test("a normal concurrent request reuses the active run without scheduling a replay", async () => {
  const post = deferred();
  const h = harness({ remote: async () => post.promise });
  const first = h.service.request("startup");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.service.request("connectivity-confirmed"), first);
  post.resolve({ ok: true });
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.listCalls.length, 1);
  assert.equal(h.service.getDiagnostics().followUpRuns, 0);
});

test("cancellation removes an already queued follow-up", async () => {
  const post = deferred();
  const h = harness({ remote: async () => post.promise });
  const first = h.service.request("startup");
  await new Promise((resolve) => setImmediate(resolve));
  h.service.request("mame-close", { ensureFollowUp: true });
  h.service.cancel("offline");
  post.resolve({ ok: true });
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.listCalls.length, 1);
  assert.equal(h.acknowledged.length, 0);
  assert.equal(h.service.getDiagnostics().followUpQueued, false);
});

test("offline and backoff preserve new pending without bypass or parallel retries", async () => {
  let offlineListCalls = 0;
  const offline = createPlayTimeSyncService({
    createStoreImpl: () => ({ listPending: async () => { offlineListCalls += 1; return [{ eventId: "offline" }]; } }),
    getConnectivityState: () => ({ reachability: "offline" }),
  });
  assert.deepEqual(await offline.request("mame-close", { ensureFollowUp: true }), { attempted: false, reason: "offline" });
  assert.equal(offlineListCalls, 0);

  let clock = 1_000;
  const firstPost = deferred();
  const pending = [{ eventId: "event-a", gameKey: "space-invaders" }];
  const sent = [];
  let listCalls = 0;
  const service = createPlayTimeSyncService({
    config: { webBaseUrl: "https://example.test" },
    createStoreImpl: () => ({
      acknowledge: async (eventId) => {
        const index = pending.findIndex((event) => event.eventId === eventId);
        if (index >= 0) pending.splice(index, 1);
      },
      listPending: async () => { listCalls += 1; return [...pending]; },
      reject: async () => {},
    }),
    getConnectivityState: () => ({ reachability: "connected" }),
    now: () => clock,
    postEventImpl: async ({ event }) => {
      sent.push(event.eventId);
      return event.eventId === "event-a" && sent.length === 1
        ? firstPost.promise
        : { ok: true };
    },
    readKnownAccountsImpl: async () => ({ accounts: [{ userId: "player" }] }),
    resolveSessionResultImpl: async () => ({
      remoteUsable: true,
      storedSession: { session: { access_token: "secret" } },
    }),
  });
  const first = service.request("startup");
  await new Promise((resolve) => setImmediate(resolve));
  pending.push({ eventId: "event-b", gameKey: "space-invaders" });
  service.request("mame-close", { ensureFollowUp: true });
  firstPost.resolve({ failureType: "throttled", ok: false, retryAfterMs: 5_000, terminal: false });
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listCalls, 1);
  assert.deepEqual(pending.map((event) => event.eventId), ["event-a", "event-b"]);
  assert.equal(service.getDiagnostics().skippedBackoff, 1);
  assert.equal(service.getDiagnostics().retryNotBefore, 6_000);

  clock = 6_000;
  const retried = await service.request("connectivity-restored");
  assert.equal(retried.acknowledged, 2);
  assert.deepEqual(sent, ["event-a", "event-a", "event-b"]);
  assert.deepEqual(pending, []);
});
