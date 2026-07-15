const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRankingCapabilitiesService,
  safeRankingUrl,
} = require("../src/ranking-capabilities-service");

function jsonResponse(body, status = 200) {
  return {
    headers: {
      get(name) {
        return {
          "x-hsl-build": body?.build || "unknown",
          "x-hsl-environment": body?.environment || "unknown",
          "x-hsl-launcher-api-version": String(body?.version || 1),
        }[String(name).toLowerCase()] || null;
      },
    },
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function harness(overrides = {}) {
  let now = 1_700_000_000_000;
  let connectivityState = {
    deployment: { apiVersion: 1, build: "unknown", environment: "unknown" },
    deploymentGeneration: 1,
    displayStatus: "connected",
    probe: { phase: "idle", inFlight: false },
    reachability: "connected",
    reachabilityGeneration: 1,
  };
  const calls = [];
  const transportFailures = [];
  const reachableResponses = [];
  const timers = new Map();
  let timerId = 0;
  const service = createRankingCapabilitiesService({
    now: () => now,
    getConnectivityState: () => connectivityState,
    setTimeout: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetchImpl: overrides.fetchImpl || (async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return jsonResponse({
        version: 1,
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "available",
          reason: "public-week",
          url: `https://hsl.example/weeks/${request.weekId}`,
        })),
      });
    }),
    onTransportFailure: (source) => transportFailures.push(source),
    onReachable: (source) => reachableResponses.push(source),
    config: {
      availableTtlMs: 300_000,
      unavailableTtlMs: 120_000,
      unknownTtlMs: 20_000,
      requestTimeoutMs: 4_000,
      batchLimit: overrides.batchLimit || 100,
    },
  });

  return {
    calls,
    service,
    timers,
    transportFailures,
    reachableResponses,
    advance(ms) { now += ms; },
    setConnectivity(status) {
      connectivityState = {
        deployment: connectivityState.deployment,
        deploymentGeneration: connectivityState.deploymentGeneration,
        displayStatus: status === "connected" ? "connected" : "offline",
        probe: { phase: "idle", inFlight: false },
        reachability: status === "connected" ? "connected" : "offline",
        reachabilityGeneration: connectivityState.reachabilityGeneration + 1,
      };
    },
  };
}

test("deduplicates canonical week identities into one batch", async () => {
  const h = harness();
  h.service.updateContext({
    webBaseUrl: "https://hsl.example",
    packs: [{ weekId: "week-1" }, { weekId: "week-1" }, { weekId: "week-2" }],
  });
  await h.service.refresh();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].requests.map((item) => item.weekId), ["week-1", "week-2"]);
  assert.equal(h.service.getCapability("week-1").status, "available");
});

test("shares one promise for concurrent refreshes", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (_url, init) => new Promise((resolve) => {
      const body = JSON.parse(init.body);
      resolveFetch = () => resolve(jsonResponse({
        version: 1,
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "available",
          reason: "public-week",
          url: `https://hsl.example/weeks/${request.weekId}`,
        })),
      }));
    }),
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  const first = h.service.refresh();
  const second = h.service.refresh();
  assert.equal(first, second);
  resolveFetch();
  await first;
});

test("partitions only when the server batch limit requires it", async () => {
  const h = harness({ batchLimit: 2 });
  h.service.updateContext({
    webBaseUrl: "https://hsl.example",
    packs: [{ weekId: "week-1" }, { weekId: "week-2" }, { weekId: "week-3" }],
  });
  await h.service.refresh();
  assert.equal(h.calls.length, 2);
});

test("reuses fresh cache and refreshes after TTL", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  await h.service.refresh();
  assert.equal(h.calls.length, 1);
  h.advance(300_001);
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.equal(h.service.getCapability("week-1").freshness, "soft-stale");
  await h.service.refresh();
  assert.equal(h.calls.length, 2);
});

test("available stays enabled while a compatible background refresh is in flight", async () => {
  let resolveRefresh;
  let call = 0;
  const h = harness({
    fetchImpl: async (_url, init) => {
      call += 1;
      const body = JSON.parse(init.body);
      if (call > 1) {
        return new Promise((resolve) => { resolveRefresh = () => resolve(jsonResponse({
          version: 1,
          results: body.requests.map((request) => ({ requestKey: request.requestKey, status: "available", reason: "public-week", url: `https://hsl.example/weeks/${request.weekId}` })),
        })); });
      }
      return jsonResponse({ version: 1, results: body.requests.map((request) => ({ requestKey: request.requestKey, status: "available", reason: "public-week", url: `https://hsl.example/weeks/${request.weekId}` })) });
    },
  });
  h.service.updateContext({ activeInstanceKey: "pack-a", webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  h.advance(300_001);
  const pending = h.service.refresh("ttl-expired");
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.equal(h.service.getCapability("week-1").freshness, "revalidating");
  resolveRefresh();
  await pending;
});

test("equivalent context is stable and real pack change invalidates capability", async () => {
  const h = harness();
  h.service.updateContext({ activeInstanceKey: "pack-a", webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-2" }, { weekId: "week-1" }] });
  await h.service.refresh();
  const before = h.service.getState();
  h.service.updateContext({ activeInstanceKey: "pack-a", webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }, { weekId: "week-2" }] });
  assert.equal(h.service.getState().contextGeneration, before.contextGeneration);
  h.service.updateContext({ activeInstanceKey: "pack-b", webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }, { weekId: "week-2" }] });
  assert.notEqual(h.service.getCapability("week-1").status, "available");
  assert.ok(h.service.getDiagnostics("week-1").transitions.length > 0);
});

test("temporary failures are unknown and conclusive server results are unavailable", async () => {
  let mode = "failure";
  const h = harness({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (mode === "failure") throw new Error("network down");
      return jsonResponse({
        version: 1,
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "unavailable",
          reason: "not-public",
          url: null,
        })),
      });
    },
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  const unknown = h.service.getCapability("week-1");
  assert.equal(new Date(unknown.expiresAt) - new Date(unknown.checkedAt), 20_000);
  mode = "success";
  await h.service.refresh("retry", { force: true });
  const unavailable = h.service.getCapability("week-1");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(new Date(unavailable.expiresAt) - new Date(unavailable.checkedAt), 120_000);
});

test("offline skips requests and packs without week identity are not configured", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: null }] });
  assert.equal(h.service.getCapability(null).reason, "not-configured");
  h.setConnectivity("offline");
  await h.service.refresh();
  assert.equal(h.calls.length, 0);
});

test("unsafe server URLs become unknown rather than available", async () => {
  const h = harness({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({
        version: 1,
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "available",
          reason: "public-week",
          url: "https://other.example/weeks/week-1",
        })),
      });
    },
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  assert.equal(h.service.getCapability("week-1").reason, "unsafe-url");
  assert.deepEqual(h.transportFailures, []);
});

test("transport errors request connectivity reevaluation", async () => {
  const h = harness({
    fetchImpl: async () => {
      throw new Error("dns failure");
    },
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.deepEqual(h.transportFailures, ["ranking-capabilities"]);
});

test("HTTP 503 is unknown but confirms HSL reachability and records a safe code", async () => {
  const h = harness({
    fetchImpl: async () => jsonResponse({
      code: "RANKING_CONTEXT_QUERY_FAILED",
      error: "No se pudo comprobar la disponibilidad.",
    }, 503),
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  assert.deepEqual(h.reachableResponses, ["ranking-capabilities-response"]);
  assert.deepEqual(h.transportFailures, []);
  assert.equal(h.service.getDiagnostics("week-1").lastRequest.httpStatus, 503);
  assert.equal(h.service.getDiagnostics("week-1").lastRequest.errorCode, "RANKING_CONTEXT_QUERY_FAILED");
});

test("a response crossing an offline generation cannot populate cache", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (_url, init) => new Promise((resolve) => {
      const body = JSON.parse(init.body);
      resolveFetch = () => resolve(jsonResponse({
        version: 1,
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "available",
          reason: "public-week",
          url: `https://hsl.example/weeks/${request.weekId}`,
        })),
      }));
    }),
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  const pending = h.service.refresh();
  h.setConnectivity("offline");
  resolveFetch();
  await pending;
  assert.equal(h.service.getDiagnostics("week-1").cache.available, 0);
});

test("discards stale library responses", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (_url, init) => new Promise((resolve) => {
      const body = JSON.parse(init.body);
      resolveFetch = () => resolve(jsonResponse({
        version: 1,
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "available",
          reason: "public-week",
          url: `https://hsl.example/weeks/${request.weekId}`,
        })),
      }));
    }),
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  const pending = h.service.refresh();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-2" }] });
  resolveFetch();
  await pending;
  assert.equal(h.service.getCapability("week-2").status, "checking");
});

test("rejects unsafe schemes and foreign origins", () => {
  assert.equal(safeRankingUrl("javascript:alert(1)", "https://hsl.example"), null);
  assert.equal(safeRankingUrl("https://other.example/weeks/1", "https://hsl.example"), null);
  assert.equal(safeRankingUrl("https://hsl.example/weeks/1", "https://hsl.example"), "https://hsl.example/weeks/1");
});

test("deployment mismatch cannot populate ranking cache", async () => {
  const h = harness({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({
        version: 1,
        build: "ranking-build",
        environment: "production",
        results: body.requests.map((request) => ({
          requestKey: request.requestKey,
          status: "available",
          reason: "public-week",
          url: `https://hsl.example/weeks/${request.weekId}`,
        })),
      });
    },
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  assert.equal(h.service.getCapability("week-1").reason, "deployment-mismatch");
  assert.equal(h.service.getDiagnostics("week-1").lastRequest.deploymentMatchesHealth, false);
});
