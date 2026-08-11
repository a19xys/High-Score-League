const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { launchMame } = require("../src/mame-launcher");
const { getOrCreatePresenceClientId } = require("../src/presence-client-id");
const { requestLauncherPresence } = require("../src/presence-http");
const { createPresenceService, PRESENCE_HEARTBEAT_INTERVAL_MS } = require("../src/presence-service");
const { createSessionResult } = require("../src/session-result");

function validSession(userId) {
  return createSessionResult({
    status: "valid",
    storedSession: {
      session: { access_token: `token-${userId}`, expires_at: 2_000_000_000 },
      user: { id: userId },
    },
  });
}

function harness(overrides = {}) {
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  let connected = overrides.connected !== false;
  const service = createPresenceService({
    config: { userDataDir: "C:/fixture", webBaseUrl: "https://hsl.test" },
    getClientIdImpl: async () => "11111111-1111-4111-8111-111111111111",
    getConnectivityState: () => ({ reachability: connected ? "connected" : "offline" }),
    requestPresenceImpl: async (request) => {
      calls.push({ method: request.method, payload: request.payload, token: request.accessToken });
      return overrides.requestResult || { ok: true, httpStatus: 200 };
    },
    resolveSessionResultImpl: async (_config, options) => overrides.sessionResult || validSession(options.userId),
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, {
        callback() {
          timers.delete(id);
          callback();
        },
        delay,
      });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    calls,
    service,
    timers,
    setConnected(value) { connected = value; },
  };
}

test("launcher Presence HTTP uses bearer POST/DELETE and treats server failures as best-effort", async () => {
  const requests = [];
  for (const method of ["POST", "DELETE"]) {
    const result = await requestLauncherPresence({
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      method,
      payload: { version: 1, clientId: "11111111-1111-4111-8111-111111111111" },
      webBaseUrl: "https://hsl.test/",
    });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(requests.map((request) => request.init.method), ["POST", "DELETE"]);
  assert.equal(requests[0].url, "https://hsl.test/api/launcher/presence");
  assert.equal(requests[0].init.headers.Authorization, "Bearer secret-token");
  const failed = await requestLauncherPresence({
    accessToken: "secret-token",
    fetchImpl: async () => new Response(JSON.stringify({ ok: false }), { status: 500 }),
    method: "POST",
    payload: {},
    webBaseUrl: "https://hsl.test",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.failureType, "server");
});

test("launcher Presence uses one stable installation id without personal data", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-presence-id-"));
  try {
    const first = await getOrCreatePresenceClientId({ userDataDir }, { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    const second = await getOrCreatePresenceClientId({ userDataDir }, { randomUUID: () => "22222222-2222-4222-8222-222222222222" });
    assert.equal(first, second);
    const raw = await fsp.readFile(path.join(userDataDir, "presence", "client-id.json"), "utf8");
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["clientId", "schemaVersion"]);
  } finally {
    await fsp.rm(userDataDir, { force: true, recursive: true });
  }
});

test("only the active account heartbeats and account switch clears B before connecting C", async () => {
  const h = harness();
  await h.service.start();
  await h.service.setActiveUserId("B");
  h.calls.length = 0;
  await h.service.setActiveUserId("C");
  assert.deepEqual(h.calls.map((call) => [call.method, call.token]), [
    ["DELETE", "token-B"],
    ["POST", "token-C"],
  ]);
  assert.equal(h.calls[1].payload.activity, "connected");
  await h.service.shutdown();
});

test("a remembered active account assigned during startup emits launcher connected without selector interaction", async () => {
  const h = harness();
  await h.service.setActiveUserId("B");
  assert.equal(h.calls.length, 0);
  await h.service.start();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "POST");
  assert.equal(h.calls[0].payload.activity, "connected");
  assert.equal(h.calls[0].token, "token-B");
  await h.service.shutdown();
});

test("explicit logout/removal cleanup runs while the old token exists and is not duplicated by state publication", async () => {
  const h = harness();
  await h.service.start();
  await h.service.setActiveUserId("B");
  h.calls.length = 0;
  await h.service.clearCurrent("logout");
  await h.service.setActiveUserId(null);
  assert.deepEqual(h.calls.map((call) => [call.method, call.token]), [["DELETE", "token-B"]]);
  await h.service.shutdown();
});

test("spawn/close publishes playing practice or competition and pre-spawn errors never publish playing", async () => {
  for (const mode of ["practice", "competition"]) {
    const h = harness();
    await h.service.start();
    await h.service.setActiveUserId("A");
    h.calls.length = 0;
    const lifecycle = h.service.createMameLifecycle({ userId: "A", weekId: "week-a", mode });
    await lifecycle.onSpawn();
    await lifecycle.onClose();
    assert.deepEqual(h.calls.filter((call) => call.method === "POST").map((call) => call.payload.activity), ["playing", "connected"]);
    assert.equal(h.calls[0].payload.mode, mode);

    h.calls.length = 0;
    const beforeSpawn = h.service.createMameLifecycle({ userId: "A", weekId: "week-a", mode });
    const originalLog = console.log;
    console.log = () => {};
    try {
      await assert.rejects(launchMame(
        { mame: { executablePath: "C:/MAME/mame.exe", workingDir: "C:/MAME" } },
        "invaders",
        mode,
        () => {
          const child = new EventEmitter();
          process.nextTick(() => child.emit("error", new Error("spawn failed")));
          return child;
        },
        beforeSpawn,
      ), /spawn failed/);
    } finally { console.log = originalLog; }
    assert.equal(h.calls.length, 0);
    await h.service.shutdown();
  }
});

test("offline changes are not queued and reconnect emits only the current state", async () => {
  const h = harness({ connected: false });
  await h.service.start();
  await h.service.setActiveUserId("A");
  const lifecycle = h.service.createMameLifecycle({ userId: "A", weekId: "week-a", mode: "practice" });
  await lifecycle.onSpawn();
  assert.equal(h.calls.length, 0);
  h.setConnected(true);
  await h.service.setOnline(true, "connectivity-restored");
  assert.equal(h.calls.at(-1).payload.activity, "playing");
  h.setConnected(false);
  await lifecycle.onClose();
  h.setConnected(true);
  await h.service.setOnline(true, "connectivity-restored");
  assert.equal(h.calls.at(-1).payload.activity, "connected");
  await h.service.shutdown();
});

test("heartbeat is 30 seconds, single-flight, auth failures stay silent and shutdown clears timers", async () => {
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  const h = harness({ requestResult: pending });
  await h.service.start();
  const accountChange = h.service.setActiveUserId("A");
  await new Promise((resolve) => setImmediate(resolve));
  const first = h.service.request("manual-a");
  const second = h.service.request("manual-b");
  assert.equal(first, second);
  resolveRequest({ ok: true, httpStatus: 200 });
  await accountChange;
  await h.service.shutdown();

  const stable = harness();
  await stable.service.start();
  await stable.service.setActiveUserId("A");
  assert.equal([...stable.timers.values()][0].delay, PRESENCE_HEARTBEAT_INTERVAL_MS);
  assert.equal(stable.timers.size, 1);
  stable.calls.length = 0;
  [...stable.timers.values()][0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stable.calls.at(-1).payload.activity, "connected");
  await stable.service.shutdown();
  assert.equal(stable.timers.size, 0);

  const terminal = harness({ sessionResult: createSessionResult({ status: "revoked" }) });
  await terminal.service.start();
  await terminal.service.setActiveUserId("A");
  assert.equal(terminal.calls.length, 0);
  assert.ok(terminal.service.getDiagnostics().deferred > 0);
  await terminal.service.shutdown();
});

test("launcher integration composes Presence and Playtime over the same MAME lifecycle without coupling stores", async () => {
  const [service, main, presence] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "src", "presence-service.js"), "utf8"),
  ]);
  assert.match(service, /combineMameLifecycles/);
  assert.match(service, /createMamePlayTimeLifecycle\(context, mode\)[\s\S]*presence/);
  assert.match(service, /createMameOperationLifecycle\(context, "practice"\)/);
  assert.match(service, /createMameOperationLifecycle\(context, "competition"\)/);
  assert.match(main, /presence\?\.setActiveUserId\(nextUserId\)/);
  assert.match(main, /startupSession[\s\S]*presence\?\.setActiveUserId/);
  assert.match(main, /presence = createPresenceService\([\s\S]*resolveSessionResultImpl:[^\n]*resolveCanonicalSessionForRemote/);
  assert.match(main, /presence\?\.shutdown\(\)/);
  assert.match(service, /preparePresenceAccountChange\("logout"\)/);
  assert.match(service, /preparePresenceAccountChange\("switch-account"\)/);
  assert.match(service, /wasActive[\s\S]*preparePresenceAccountChange\("remove-account"\)/);
  assert.doesNotMatch(presence, /playtime|submission|outbox|writeFile|recordEvent/i);
});
