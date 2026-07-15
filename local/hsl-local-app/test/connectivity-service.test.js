const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createConnectivityService,
  healthEndpoint,
  normalizeWebBaseUrl,
} = require("../src/connectivity-service");

function harness(overrides = {}) {
  let now = 1_700_000_000_000;
  let online = overrides.online ?? true;
  let nextTimerId = 0;
  const timers = new Map();
  const calls = [];
  let netChecks = 0;
  const service = createConnectivityService({
    webBaseUrl: "https://hsl.example/base?secret=no",
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
    fetchImpl: overrides.fetchImpl || (async (url, init) => {
      calls.push({ url, init });
      return { status: 204, url };
    }),
    config: {
      connectedIntervalMs: 300_000,
      focusStaleMs: 90_000,
      healthTimeoutMs: 4_000,
      jitterRatio: 0.15,
      offlineRetryMs: 60_000,
      retryBackoffMs: [5_000, 15_000, 30_000],
    },
  });

  return {
    calls,
    service,
    timers,
    advance(ms) { now += ms; },
    setOnline(value) { online = value; },
    get netChecks() { return netChecks; },
  };
}

test("normalizes only http origins and fixes the health endpoint", () => {
  assert.equal(normalizeWebBaseUrl("https://user:pass@hsl.example/path?q=1"), "https://hsl.example");
  assert.equal(normalizeWebBaseUrl("file:///tmp"), null);
  assert.equal(healthEndpoint("http://localhost:3000/path"), "http://localhost:3000/api/launcher/health");
});

test("net false is offline and net true requires a valid health response", async () => {
  const offline = harness({ online: false });
  assert.equal(offline.netChecks, 0);
  await offline.service.start();
  assert.equal(offline.service.getState().status, "offline");
  assert.equal(offline.calls.length, 0);

  const online = harness();
  const pending = online.service.start();
  assert.equal(online.service.getState().status, "connecting");
  await pending;
  assert.equal(online.service.getState().status, "connected");
  assert.equal(online.calls.length, 1);
});

test("timeout and DNS failures stay connecting with sanitized reasons", async () => {
  const timeout = harness({
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  const pending = timeout.service.start();
  const timeoutTimer = [...timeout.timers.values()].find((timer) => timer.delay === 4_000);
  timeoutTimer.callback();
  await pending;
  assert.equal(timeout.service.getState().reason, "timeout");

  const dns = harness({
    fetchImpl: async () => {
      throw Object.assign(new Error("host secret.example failed"), { code: "ENOTFOUND" });
    },
  });
  await dns.service.start();
  assert.equal(dns.service.getState().reason, "dns");
  assert.equal(JSON.stringify(dns.service.getState()).includes("secret.example"), false);
});

test("deduplicates concurrent checks and honors connected TTL", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (url) => new Promise((resolve) => {
      resolveFetch = () => resolve({ status: 204, url });
    }),
  });
  const first = h.service.start();
  const second = h.service.refresh("renderer-online", { force: true });

  assert.equal(first, second);
  resolveFetch();
  await first;
  await h.service.refresh("focus");
  assert.equal(h.service.getState().status, "connected");
});

test("timeout and unexpected responses remain connecting with backoff", async () => {
  const unexpected = harness({
    fetchImpl: async (url) => ({ status: 200, url }),
  });
  await unexpected.service.start();
  assert.equal(unexpected.service.getState().status, "connecting");
  assert.equal(unexpected.service.getState().reason, "unexpected-status");
  assert.equal(unexpected.service.getState().consecutiveFailures, 1);
  assert.equal([...unexpected.timers.values()].some((timer) => timer.delay === 5_000), true);
});

test("backoff jitter stays bounded and success resets failures", async () => {
  let succeeds = false;
  const h = harness({
    random: () => 1,
    fetchImpl: async (url) => succeeds
      ? { status: 204, url }
      : Promise.reject(new Error("temporary")),
  });
  await h.service.start();
  const retry = [...h.timers.values()].find((timer) => timer.delay !== 4_000);
  assert.ok(retry.delay >= 4_250 && retry.delay <= 5_750);
  succeeds = true;
  await h.service.refresh("recovery", { force: true });
  assert.equal(h.service.getState().status, "connected");
  assert.equal(h.service.getState().consecutiveFailures, 0);
});

test("stale generation cannot overwrite offline and stop clears timers", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (url) => new Promise((resolve) => {
      resolveFetch = () => resolve({ status: 204, url });
    }),
  });
  const pending = h.service.start();
  h.setOnline(false);
  await h.service.refresh("renderer-offline", { force: true });
  resolveFetch();
  await pending;
  assert.equal(h.service.getState().status, "offline");
  h.service.stop();
  assert.equal(h.timers.size, 0);
});

test("changing webBaseUrl invalidates the previous generation", async () => {
  const h = harness();
  await h.service.start();
  await h.service.setWebBaseUrl("https://other.example/path");
  assert.equal(h.service.getDiagnostics().healthEndpoint, "https://other.example/api/launcher/health");
  assert.equal(h.service.getState().status, "connected");
});
