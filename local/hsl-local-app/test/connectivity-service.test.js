const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createConnectivityService,
  deriveConnectivityDisplayState,
  healthEndpoint,
  normalizeWebBaseUrl,
} = require("../src/connectivity-service");

function harness(overrides = {}) {
  let now = 1_700_000_000_000;
  let online = overrides.online ?? true;
  let fetchImpl = overrides.fetchImpl || (async (url) => ({ status: 204, url }));
  let nextTimerId = 0;
  const timers = new Map();
  const calls = [];
  let netChecks = 0;
  const service = createConnectivityService({
    webBaseUrl: Object.prototype.hasOwnProperty.call(overrides, "webBaseUrl")
      ? overrides.webBaseUrl
      : "https://hsl.example/base?secret=no",
    now: () => now,
    netIsOnline: () => {
      netChecks += 1;
      return online;
    },
    random: overrides.random || (() => 0.5),
    setTimeout: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay, dueAt: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const response = await fetchImpl(url, init);
      return {
        ...response,
        headers: response.headers || {
          get(name) {
            return {
              "x-hsl-build": "test-build",
              "x-hsl-environment": "development",
              "x-hsl-launcher-api-version": "1",
            }[String(name).toLowerCase()] || null;
          },
        },
      };
    },
    config: {
      connectedIntervalMs: 300_000,
      focusStaleMs: 90_000,
      healthTimeoutMs: 4_000,
      jitterRatio: 0.15,
      offlineRetryMs: 60_000,
      offlineFastIntervalMs: 3_000,
      offlineFastWindowMs: 60_000,
      offlineMediumIntervalMs: 5_000,
      offlineMediumWindowMs: 300_000,
      offlineLongRetryMs: [10_000, 20_000, 30_000, 60_000],
      recoveryCanaryTimeoutMs: 1_000,
      retryBackoffMs: [5_000, 15_000, 30_000],
    },
  });

  return {
    calls,
    service,
    timers,
    advance(ms) { now += ms; },
    setFetch(value) { fetchImpl = value; },
    setOnline(value) { online = value; },
    get netChecks() { return netChecks; },
  };
}

test("normalizes origins and derives visible states only from real probes", () => {
  assert.equal(normalizeWebBaseUrl("https://user:pass@hsl.example/path?q=1"), "https://hsl.example");
  assert.equal(normalizeWebBaseUrl("file:///tmp"), null);
  assert.equal(healthEndpoint("http://localhost:3000/path"), "http://localhost:3000/api/launcher/health");
  assert.equal(deriveConnectivityDisplayState({
    reachability: "unknown",
    probe: { phase: "startup", inFlight: true },
  }), "connecting");
  assert.equal(deriveConnectivityDisplayState({
    reachability: "offline",
    probe: { phase: "retry", inFlight: true },
  }), "reconnecting");
  assert.equal(deriveConnectivityDisplayState({
    reachability: "connected",
    probe: { phase: "background", inFlight: true },
  }), "connected");
  assert.equal(deriveConnectivityDisplayState({
    reachability: "offline",
    probe: { phase: "retry", inFlight: false },
  }), "offline");
});

test("startup is connecting only in flight and settles connected or offline", async () => {
  let resolveFetch;
  const online = harness({
    fetchImpl: (url) => new Promise((resolve) => {
      resolveFetch = () => resolve({ status: 204, url });
    }),
  });
  assert.equal(online.netChecks, 0);
  const pending = online.service.start();
  assert.equal(online.service.getState().displayStatus, "connecting");
  assert.equal(online.service.getState().probe.inFlight, true);
  resolveFetch();
  await pending;
  assert.equal(online.service.getState().reachability, "connected");
  assert.equal(online.service.getState().displayStatus, "connected");
  assert.equal(online.service.getState().probe.inFlight, false);

  const failed = harness({ fetchImpl: async () => { throw new Error("transport"); } });
  await failed.service.start();
  assert.equal(failed.service.getState().reachability, "offline");
  assert.equal(failed.service.getState().displayStatus, "offline");
  assert.equal(failed.service.getState().probe.inFlight, false);
});

test("missing or invalid origins stay unknown and never start probes", async () => {
  for (const webBaseUrl of [null, undefined, "not-an-origin"]) {
    const h = harness({ webBaseUrl });
    await h.service.start();
    h.service.confirmSystemOffline("topology-change");
    assert.equal(h.service.getState().reachability, "unknown");
    assert.equal(h.service.getState().displayStatus, "unknown");
    assert.equal(h.service.getState().reason, "missing-hsl-origin");
    assert.equal(h.calls.length, 0);
    assert.equal(h.netChecks, 0);
    assert.equal(h.timers.size, 0);
  }
});

test("net false is immediately offline and net true never confirms connected", async () => {
  const offline = harness({ online: false });
  await offline.service.start();
  assert.equal(offline.service.getState().reachability, "offline");
  assert.equal(offline.calls.length, 0);

  const virtualAdapter = harness({ fetchImpl: async () => { throw new Error("unreachable"); } });
  await virtualAdapter.service.start();
  assert.equal(virtualAdapter.service.getState().netIsOnline, true);
  assert.equal(virtualAdapter.service.getState().displayStatus, "offline");
});

test("offline retries show reconnecting only while the request exists", async () => {
  let succeeds = false;
  let resolveRetry;
  const h = harness({
    fetchImpl: async () => {
      if (!succeeds) throw new Error("down");
      return new Promise((resolve) => { resolveRetry = resolve; });
    },
  });
  await h.service.start();
  assert.equal(h.service.getState().displayStatus, "offline");
  succeeds = true;
  const retryTimer = [...h.timers.values()].find((timer) => timer.delay === 3_000);
  retryTimer.callback();
  assert.equal(h.service.getState().displayStatus, "reconnecting");
  assert.equal(h.service.getState().probe.inFlight, true);
  resolveRetry({ status: 204, url: "https://hsl.example/api/launcher/health" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.service.getState().displayStatus, "connected");
});

test("offline recovery uses a short canary independently from focus", async () => {
  const h = harness({ fetchImpl: async () => { throw new Error("down"); } });
  await h.service.start();
  const state = h.service.getState();
  assert.equal(state.scheduler.timerKind, "offline-recovery");
  assert.equal(state.scheduler.intervalMs, 3_000);
  assert.equal(state.scheduler.timeoutMs, 1_000);
  h.service.setActivity("background", "blur");
  assert.equal(h.service.getState().scheduler.intervalMs, 3_000);
  assert.equal(h.service.getState().scheduler.timerKind, "offline-recovery");
});

test("manual probes reconnect, deduplicate and settle without transient idle", async () => {
  let resolveFetch;
  const h = harness();
  await h.service.start();
  h.setFetch((url) => new Promise((resolve) => {
    resolveFetch = () => resolve({ status: 204, url });
  }));
  const first = h.service.refresh("manual", { force: true, phase: "manual" });
  const second = h.service.refresh("manual", { force: true, phase: "manual" });
  assert.equal(first, second);
  assert.equal(h.service.getState().displayStatus, "reconnecting");
  resolveFetch();
  await first;
  assert.equal(h.service.getState().displayStatus, "connected");
  assert.equal(h.service.getState().probe.inFlight, false);
});

test("manual refresh promotes an existing background probe without duplicating it", async () => {
  let resolveFetch;
  const h = harness();
  await h.service.start();
  h.setFetch((url) => new Promise((resolve) => {
    resolveFetch = () => resolve({ status: 204, url });
  }));
  const background = h.service.refresh("periodic", { force: true, phase: "background" });
  assert.equal(h.service.getState().displayStatus, "connected");

  const manual = h.service.refresh("manual", { force: true, phase: "manual" });
  assert.equal(manual, background);
  assert.equal(h.calls.length, 2);
  assert.equal(h.service.getState().probe.phase, "manual");
  assert.equal(h.service.getState().displayStatus, "reconnecting");

  resolveFetch();
  await manual;
  assert.equal(h.service.getState().displayStatus, "connected");
});

test("background probes keep connected visible and failure goes directly offline", async () => {
  let rejectFetch;
  const h = harness();
  await h.service.start();
  h.setFetch(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));
  const pending = h.service.refresh("periodic", { force: true, phase: "background" });
  assert.equal(h.service.getState().displayStatus, "connected");
  assert.equal(h.service.getState().probe.phase, "background");
  rejectFetch(new Error("lost"));
  await pending;
  assert.equal(h.service.getState().displayStatus, "offline");
  assert.equal(h.service.getState().probe.inFlight, false);
});

test("timeout, DNS and unexpected status settle offline with sanitized reasons", async () => {
  const timeout = harness({
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  const pending = timeout.service.start();
  [...timeout.timers.values()].find((timer) => timer.delay === 4_000).callback();
  await pending;
  assert.equal(timeout.service.getState().reason, "timeout");
  assert.equal(timeout.service.getState().displayStatus, "offline");

  const dns = harness({ fetchImpl: async () => { throw Object.assign(new Error("secret host"), { code: "ENOTFOUND" }); } });
  await dns.service.start();
  assert.equal(dns.service.getState().reason, "dns");
  assert.equal(JSON.stringify(dns.service.getState()).includes("secret host"), false);

  const unexpected = harness({ fetchImpl: async (url) => ({ status: 200, url }) });
  await unexpected.service.start();
  assert.equal(unexpected.service.getState().reason, "unexpected-status");
  assert.equal(unexpected.service.getState().displayStatus, "offline");
});

test("stale probes cannot overwrite offline and stop clears timers", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (url) => new Promise((resolve) => { resolveFetch = () => resolve({ status: 204, url }); }),
  });
  const pending = h.service.start();
  h.setOnline(false);
  await h.service.refresh("renderer-offline", { force: true, phase: "background" });
  resolveFetch();
  await pending;
  assert.equal(h.service.getState().reachability, "offline");
  h.service.stop();
  assert.equal(h.timers.size, 0);
});

test("changing webBaseUrl invalidates the old origin and probes silently", async () => {
  const h = harness();
  await h.service.start();
  await h.service.setWebBaseUrl("https://other.example/path");
  assert.equal(h.service.getDiagnostics().healthEndpoint, "https://other.example/api/launcher/health");
  assert.equal(h.service.getState().reachability, "connected");
});

test("strong negative signals settle offline immediately and abort stale probes", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (url) => new Promise((resolve) => { resolveFetch = () => resolve({ status: 204, url }); }),
  });
  const startup = h.service.start();
  h.setOnline(false);
  h.service.confirmSystemOffline("renderer-offline");
  assert.equal(h.service.getState().reachability, "offline");
  assert.equal(h.service.getState().source, "renderer-offline");
  resolveFetch();
  await startup;
  assert.equal(h.service.getState().reachability, "offline");
});

test("system offline boundary verifies net state and public API cannot mark connected", async () => {
  const h = harness({ fetchImpl: async () => { throw new Error("down"); } });
  await h.service.start();
  assert.equal(h.service.getState().reachability, "offline");
  const callsBefore = h.calls.length;
  h.setOnline(true);
  h.service.confirmSystemOffline("renderer-offline");
  assert.equal(h.service.getState().reachability, "offline");
  assert.equal(h.calls.length, callsBefore + 1);
  assert.equal(typeof h.service.markReachable, "undefined");
  assert.equal(typeof h.service.signalOffline, "undefined");
  assert.deepEqual(h.service.getDiagnostics().authority, {
    connected: "health-204",
    offline: "health-or-main-system-offline",
    productSignals: "hints-only",
    rendererSignals: "hints-only",
  });
});

test("positive recovery signals debounce and share one probe", async () => {
  const h = harness({ fetchImpl: async () => { throw new Error("down"); } });
  await h.service.start();
  h.setFetch(async (url) => ({ status: 204, url }));
  const first = h.service.signalPossibleRecovery("renderer-online");
  const second = h.service.signalPossibleRecovery("connection-change");
  assert.equal(first, second);
  assert.equal(h.calls.length, 1);
  const debounce = [...h.timers.values()].find((entry) => entry.delay === 150);
  assert.ok(debounce);
  debounce.callback();
  await first;
  assert.equal(h.calls.length, 2);
  assert.equal(h.service.getState().reachability, "connected");
});

test("an isolated heartbeat failure gets one immediate confirmation", async () => {
  const h = harness();
  await h.service.start();
  let attempts = 0;
  h.setFetch(async (url) => {
    attempts += 1;
    if (attempts === 1) throw new Error("brief interruption");
    return { status: 204, url };
  });
  const heartbeat = [...h.timers.values()].find((entry) => entry.delay === 300_000);
  assert.ok(heartbeat);
  heartbeat.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(h.service.getState().reachability, "connected");
  assert.equal(h.service.getState().source, "heartbeat-confirmation");
  assert.equal(h.service.getState().heartbeat.confirmationPending, false);
});

test("blur keeps the bounded heartbeat and only suspend stops it", async () => {
  const h = harness();
  await h.service.start();
  assert.ok([...h.timers.values()].some((entry) => entry.delay === 300_000));
  h.service.setActivity("background", "blur");
  assert.ok([...h.timers.values()].some((entry) => entry.delay === 20_000));
  h.service.setActivity("suspended", "suspend");
  assert.equal(h.timers.size, 0);
  h.service.setActivity("active", "resume");
  assert.ok([...h.timers.values()].some((entry) => entry.delay === 300_000));
});

test("health deployment fingerprint is captured and versioned", async () => {
  const h = harness();
  await h.service.start();
  assert.deepEqual(h.service.getState().deployment, {
    apiVersion: 1,
    build: "test-build",
    environment: "development",
  });
  assert.equal(h.service.getState().deploymentGeneration, 1);
});
