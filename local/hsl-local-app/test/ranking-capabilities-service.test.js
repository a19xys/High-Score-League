const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRankingCapabilitiesService,
  safeRankingUrl,
} = require("../src/ranking-capabilities-service");

const CANONICAL_HSL_ORIGIN = "https://highscoreleague.com";
const LEGACY_HSL_ORIGIN = "https://high-score-league.vercel.app";

function jsonResponse(body, status = 200, headerOverrides = {}) {
  return {
    headers: {
      get(name) {
        return {
          "x-hsl-build": headerOverrides.build || body?.build || "unknown",
          "x-hsl-environment": headerOverrides.environment || body?.environment || "unknown",
          "x-hsl-launcher-api-version": String(headerOverrides.apiVersion || body?.version || 1),
        }[String(name).toLowerCase()] || null;
      },
    },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function availableResponse(init, overrides = {}) {
  const body = JSON.parse(init.body);
  return jsonResponse({
    build: overrides.build || "unknown",
    environment: overrides.environment || "unknown",
    version: overrides.version || 1,
    results: body.requests.map((request) => ({
      reason: "public-week",
      requestKey: request.requestKey,
      status: overrides.status || "available",
      url: overrides.status === "unavailable" ? null : `https://hsl.example/weeks/${request.weekId}`,
    })),
  }, 200, overrides.headerDeployment || {});
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
  const timers = new Map();
  const transportFailures = [];
  const reachableResponses = [];
  let timerId = 0;
  const fetchImpl = overrides.fetchImpl || (async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return availableResponse(init);
  });
  const service = createRankingCapabilitiesService({
    clearTimeout: (id) => timers.delete(id),
    config: {
      batchLimit: overrides.batchLimit || 100,
      requestTimeoutMs: 4_000,
      unknownRetryDelaysMs: overrides.unknownRetryDelaysMs || [100, 200],
    },
    fetchImpl: async (url, init) => {
      if (overrides.fetchImpl) calls.push(JSON.parse(init.body));
      return fetchImpl(url, init);
    },
    getConnectivityState: () => connectivityState,
    now: () => now,
    onReachable: (source) => reachableResponses.push(source),
    onTransportFailure: (source) => transportFailures.push(source),
    setTimeout: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
  });

  return {
    calls,
    reachableResponses,
    service,
    timers,
    transportFailures,
    advance(ms) { now += ms; },
    runNextTimer() {
      const next = [...timers.entries()].sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) return false;
      const [id, timer] = next;
      timers.delete(id);
      now = Math.max(now, timer.dueAt);
      timer.callback();
      return true;
    },
    setConnectivity(status, probe = { phase: "idle", inFlight: false }) {
      connectivityState = {
        ...connectivityState,
        displayStatus: status === "connected" ? "connected" : "offline",
        probe,
        reachability: status,
        reachabilityGeneration: connectivityState.reachabilityGeneration + 1,
      };
    },
    setDeployment(build, environment = "unknown") {
      connectivityState = {
        ...connectivityState,
        deployment: { apiVersion: 1, build, environment },
        deploymentGeneration: connectivityState.deploymentGeneration + 1,
      };
    },
  };
}

test("initial batch deduplicates every valid library week", async () => {
  const h = harness();
  h.service.updateContext({
    webBaseUrl: "https://hsl.example",
    packs: [{ weekId: "week-2" }, { weekId: "week-1" }, { weekId: "week-1" }, { weekId: null }],
  });
  await h.service.refresh("startup");
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].requests.map((item) => item.weekId), ["week-1", "week-2"]);
  assert.deepEqual(h.service.getDiagnostics().checkedWeekIds, ["week-1", "week-2"]);
});

test("concurrent consumers share one batch promise", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (_url, init) => new Promise((resolve) => { resolveFetch = () => resolve(availableResponse(init)); }),
  });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  const first = h.service.refresh();
  const second = h.service.refresh();
  assert.equal(first, second);
  resolveFetch();
  await first;
});

test("batching only partitions at the configured server limit", async () => {
  const h = harness({ batchLimit: 2 });
  h.service.updateContext({
    webBaseUrl: "https://hsl.example",
    packs: [{ weekId: "week-1" }, { weekId: "week-2" }, { weekId: "week-3" }],
  });
  await h.service.refresh();
  assert.equal(h.calls.length, 2);
});

test("available remains conclusive for 24 hours without timers or requests", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.timers.size, 0);
  for (const elapsed of [5 * 60_000, 10 * 60_000, 60 * 60_000, 24 * 60 * 60_000]) {
    h.advance(elapsed);
    await h.service.refresh("launcher-state");
    assert.equal(h.service.getCapability("week-1").status, "available");
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("unavailable also remains conclusive for the process session", async () => {
  const h = harness({ fetchImpl: async (_url, init) => availableResponse(init, { status: "unavailable" }) });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  h.advance(24 * 60 * 60_000);
  await h.service.refresh("launcher-state");
  assert.equal(h.service.getCapability("week-1").status, "unavailable");
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test("active pack identity and equivalent ordering never invalidate known weeks", async () => {
  const h = harness();
  h.service.updateContext({ activeInstanceKey: "pack-a", webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-2" }, { weekId: "week-1" }] });
  await h.service.refresh();
  const generation = h.service.getState().contextGeneration;
  h.service.updateContext({ activeInstanceKey: "pack-b", webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }, { weekId: "week-2" }] });
  await h.service.refresh("pack-change");
  assert.equal(h.service.getState().contextGeneration, generation);
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.equal(h.calls.length, 1);
});

test("library changes query only new or previously unknown weeks", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }, { weekId: "week-2" }] });
  await h.service.refresh("library-change");
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].requests.map((item) => item.weekId), ["week-2"]);
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-2" }] });
  assert.equal(h.service.getState().entries["week-1"], undefined);
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }, { weekId: "week-2" }] });
  await h.service.refresh("library-change");
  assert.equal(h.calls.length, 2);
});

test("build/environment change preserves conclusive cache and semantic generation", async () => {
  let build = "unknown";
  const h = harness({ fetchImpl: async (_url, init) => availableResponse(init, { build }) });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }, { weekId: "week-2" }] });
  await h.service.refresh();
  const generation = h.service.getState().contextGeneration;
  build = "build-2";
  h.setDeployment(build, "preview");
  h.service.updateDeployment();
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.equal(h.service.getState().contextGeneration, generation);
  await h.service.refresh("deployment-change");
  assert.equal(h.calls.length, 1);
  assert.equal(h.service.getCapability("week-1").status, "available");
});

test("startup offline defers the initial batch until committed recovery", async () => {
  const h = harness();
  h.setConnectivity("offline");
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh("startup");
  assert.equal(h.calls.length, 0);
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  h.setConnectivity("connected");
  await h.service.refresh("connectivity-restored");
  assert.equal(h.calls.length, 1);
  assert.equal(h.service.getCapability("week-1").status, "available");
});

test("retry probes use committed reachability and do not hide capabilities", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  h.setConnectivity("connected", { phase: "retry", inFlight: true });
  assert.equal(h.service.getCapability("week-1").status, "available");
  await h.service.refresh("probe");
  assert.equal(h.calls.length, 1);
});

test("temporary failures retry only unknown results with bounded timers", async () => {
  const h = harness({ fetchImpl: async () => { throw new Error("network down"); } });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  assert.equal(h.timers.size, 1);
  h.runNextTimer();
  await new Promise((resolve) => setImmediate(resolve));
  h.runNextTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 0);
});

test("development force refresh can replace a conclusive result", async () => {
  let status = "unavailable";
  const h = harness({ fetchImpl: async (_url, init) => availableResponse(init, { status }) });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unavailable");
  status = "available";
  await h.service.forceRefresh();
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.ok(h.service.getDiagnostics().lastForcedRefreshAt);
});

test("failed development refresh preserves a conclusive available result", async () => {
  let fail = false;
  const h = harness({ fetchImpl: async (_url, init) => {
    if (fail) throw new Error("temporary");
    return availableResponse(init);
  } });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  fail = true;
  await h.service.forceRefresh();
  assert.equal(h.service.getCapability("week-1").status, "available");
});

test("offline gates queries but does not invalidate a confirmed capability", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  h.setConnectivity("offline");
  await h.service.refresh("offline");
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.equal(h.calls.length, 1);
});

test("responses crossing offline or semantic context generations are discarded", async () => {
  let resolveFetch;
  const h = harness({ fetchImpl: (_url, init) => new Promise((resolve) => { resolveFetch = () => resolve(availableResponse(init)); }) });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  const pending = h.service.refresh();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-2" }] });
  resolveFetch();
  await pending;
  assert.equal(h.service.getCapability("week-2").status, "unknown");
});

test("Ranking in-flight acepta rolling build B con API/origin/contexto compatibles", async () => {
  let resolveFetch;
  const h = harness({
    fetchImpl: (_url, init) => new Promise((resolve) => {
      resolveFetch = () => resolve(availableResponse(init, {
        build: "body-build-b",
        environment: "preview",
        headerDeployment: { apiVersion: 1, build: "header-build-b", environment: "production" },
      }));
    }),
  });
  h.setDeployment("health-build-a", "production");
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  const generation = h.service.getState().contextGeneration;
  const pending = h.service.refresh("rolling-deployment");
  h.setDeployment("health-build-b", "production");
  h.service.updateDeployment();
  assert.equal(h.service.getState().contextGeneration, generation);
  resolveFetch();
  await pending;
  assert.equal(h.service.getCapability("week-1").status, "available");
  assert.equal(h.service.getDiagnostics().lastRequest.contractCompatible, true);
  assert.equal(h.service.getDiagnostics().lastRequest.metadataMatchesHealth, false);
  assert.equal(h.service.getDiagnostics().lastRequest.metadataMatchesHeaders, false);
});

test("unsafe URLs y API incompatible no pueden popular available", async () => {
  const unsafe = harness({ fetchImpl: async (_url, init) => {
    const response = availableResponse(init);
    const payload = await response.json();
    payload.results[0].url = "https://other.example/weeks/week-1";
    return jsonResponse(payload);
  } });
  unsafe.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await unsafe.service.refresh();
  assert.equal(unsafe.service.getCapability("week-1").status, "unknown");

  const incompatible = harness({ fetchImpl: async (_url, init) => availableResponse(init, {
    headerDeployment: { apiVersion: 2, build: "other-build", environment: "production" },
  }) });
  incompatible.setDeployment("health-build", "production");
  incompatible.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await incompatible.service.refresh();
  assert.equal(incompatible.service.getCapability("week-1").reason, "unsupported-contract");

  const incompatibleBody = harness({ fetchImpl: async (_url, init) => availableResponse(init, {
    headerDeployment: { apiVersion: 1, build: "build-a", environment: "production" },
    version: 2,
  }) });
  incompatibleBody.setDeployment("health-build", "production");
  incompatibleBody.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await incompatibleBody.service.refresh();
  assert.equal(incompatibleBody.service.getCapability("week-1").reason, "invalid-response");
});

test("HTTP responses confirm reachability while transient results stay unknown", async () => {
  const h = harness({ fetchImpl: async () => jsonResponse({ code: "RANKING_CONTEXT_QUERY_FAILED", version: 1 }, 503) });
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  assert.deepEqual(h.reachableResponses, ["ranking-capabilities-response"]);
  assert.deepEqual(h.transportFailures, []);
  assert.equal(h.service.getDiagnostics().lastRequest.errorCode, "RANKING_CONTEXT_QUERY_FAILED");
});

test("diagnostics declare session verification and no automatic TTL refresh", async () => {
  const h = harness();
  h.service.updateContext({ webBaseUrl: "https://hsl.example", packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  const diagnostics = h.service.getDiagnostics("week-1");
  assert.equal(diagnostics.verificationMode, "session");
  assert.equal(diagnostics.automaticTtlRefresh, false);
  assert.equal(diagnostics.authority.key, "launcher-api:1");
  assert.ok(diagnostics.initialBatchAt);
  assert.equal(diagnostics.context.fingerprint.includes("pack-a"), false);
  assert.ok(diagnostics.transitions.length > 0);
});

test("ranking cache treats legacy and apex as distinct same-origin authorities", async () => {
  const requestUrls = [];
  const h = harness({
    fetchImpl: async (url, init) => {
      requestUrls.push(url);
      const origin = new URL(url).origin;
      const body = JSON.parse(init.body);
      return jsonResponse({
        build: "unknown",
        environment: "unknown",
        version: 1,
        results: body.requests.map((request) => ({
          reason: "public-week",
          requestKey: request.requestKey,
          status: "available",
          url: `${origin}/weeks/${request.weekId}`,
        })),
      });
    },
  });

  h.service.updateContext({ webBaseUrl: LEGACY_HSL_ORIGIN, packs: [{ weekId: "week-1" }] });
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").url, `${LEGACY_HSL_ORIGIN}/weeks/week-1`);

  h.service.updateContext({ webBaseUrl: CANONICAL_HSL_ORIGIN, packs: [{ weekId: "week-1" }] });
  assert.equal(h.service.getCapability("week-1").status, "unknown");
  await h.service.refresh();
  assert.equal(h.service.getCapability("week-1").url, `${CANONICAL_HSL_ORIGIN}/weeks/week-1`);

  h.service.updateContext({ webBaseUrl: LEGACY_HSL_ORIGIN, packs: [{ weekId: "week-1" }] });
  assert.equal(h.service.getCapability("week-1").url, `${LEGACY_HSL_ORIGIN}/weeks/week-1`);
  assert.deepEqual(requestUrls, [
    `${LEGACY_HSL_ORIGIN}/api/launcher/ranking-capabilities`,
    `${CANONICAL_HSL_ORIGIN}/api/launcher/ranking-capabilities`,
  ]);
});

test("rejects unsafe schemes and foreign origins", () => {
  assert.equal(safeRankingUrl("javascript:alert(1)", "https://hsl.example"), null);
  assert.equal(safeRankingUrl("https://other.example/weeks/1", "https://hsl.example"), null);
  assert.equal(safeRankingUrl("https://hsl.example/weeks/1", "https://hsl.example"), "https://hsl.example/weeks/1");
  assert.equal(safeRankingUrl(`${CANONICAL_HSL_ORIGIN}/weeks/1`, CANONICAL_HSL_ORIGIN), `${CANONICAL_HSL_ORIGIN}/weeks/1`);
  assert.equal(safeRankingUrl(`${LEGACY_HSL_ORIGIN}/weeks/1`, CANONICAL_HSL_ORIGIN), null);
  assert.equal(safeRankingUrl(`${LEGACY_HSL_ORIGIN}/weeks/1`, LEGACY_HSL_ORIGIN), `${LEGACY_HSL_ORIGIN}/weeks/1`);
});
