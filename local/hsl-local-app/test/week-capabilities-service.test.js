const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWeekCapabilitiesService } = require("../src/week-capabilities-service");

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-week-service-"));
  try { return await run(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

const deployment = { apiVersion: 1, build: "build-a", environment: "production" };
function response(results, generatedAt = "2026-08-01T00:00:00.000Z", responseDeployment = deployment, version = 1) {
  return new Response(JSON.stringify({
    version,
    build: responseDeployment.build,
    environment: responseDeployment.environment,
    generatedAt,
    results,
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-hsl-build": responseDeployment.build,
      "x-hsl-environment": responseDeployment.environment,
      "x-hsl-launcher-api-version": String(responseDeployment.apiVersion),
    },
  });
}

function resultFor(request, publicState = "active") {
  return {
    requestKey: request.requestKey,
    weekId: request.weekId,
    seasonId: "season-a",
    seasonStatus: "active",
    derivedStatus: publicState,
    publicState,
    rawStatus: publicState,
    reason: `week-${publicState}`,
  };
}

test("batch remoto queda durable y un fallo posterior no destruye la verdad", async () => {
  await withTempDir(async (userDataDir) => {
    let fail = false;
    const connection = { deployment, deploymentGeneration: 1, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: async (_url, init) => {
        if (fail) throw new Error("offline");
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => ({
          requestKey: request.requestKey,
          weekId: request.weekId,
          seasonId: "season-a",
          derivedStatus: "active",
          publicState: "active",
          canPlayCompetition: true,
          publicStartAt: "2026-07-01T00:00:00.000Z",
          publicFreezeAt: null,
          finalDeadlineAt: "2026-09-01T00:00:00.000Z",
          rawStatus: "active",
          reason: "week-active",
        })));
      },
      getConnectivityState: () => connection,
      now: () => Date.parse("2026-08-01T00:00:00Z"),
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }, { weekId: "week-b" }], webBaseUrl: "https://hsl.example" });
    await service.refresh("test");
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getCapability("week-b").canPlayCompetition, true);
    fail = true;
    await service.refresh("forced-failure", { force: true });
    assert.equal(service.getCapability("week-a").publicState, "active");
    service.stop();
  });
});

test("una respuesta stale de week/deployment no adquiere autoridad", async () => {
  await withTempDir(async (userDataDir) => {
    let resolveFetch;
    const connection = { deployment, deploymentGeneration: 1, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const pending = service.refresh("stale");
    connection.deployment = { apiVersion: 1, build: "build-b", environment: "production" };
    connection.deploymentGeneration = 2;
    service.updateDeployment();
    service.updateContext({ packs: [{ weekId: "week-b" }], webBaseUrl: "https://hsl.example" });
    resolveFetch(response([{ requestKey: "week-0", weekId: "week-a", seasonId: "season-a", derivedStatus: "active", publicState: "active", reason: "week-active" }]));
    await pending;
    assert.equal(service.getCapability("week-b").publicState, "unknown");
    service.stop();
  });
});

test("un unico timeout lleva el estado local a apertura y cierre sin polling", async () => {
  await withTempDir(async (userDataDir) => {
    let now = Date.parse("2026-08-01T00:00:00Z");
    let timer = null;
    const schedule = (callback, delay) => { timer = { callback, delay }; return 1; };
    const connection = { deployment, reachability: "offline", reachabilityGeneration: 1 };
    const cache = require("../src/competitive-authority-cache").createWeekCapabilityCache({ userDataDir });
    const service = createWeekCapabilitiesService({
      cache,
      clearTimeout: () => { timer = null; },
      fetchImpl: async () => { throw new Error("must not fetch"); },
      getConnectivityState: () => connection,
      now: () => now,
      setTimeout: schedule,
      userDataDir,
    });
    await service.initialize();
    await cache.remember({ deploymentKey: "build-a:production:1", origin: "https://hsl.example" }, {
      conclusive: true,
      finalDeadlineAt: "2026-08-03T00:00:00Z",
      publicStartAt: "2026-08-02T00:00:00Z",
      publicState: "inactive",
      reason: "week-inactive",
      seasonId: "season-a",
      weekId: "week-a",
    });
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    assert.equal(service.getCapability("week-a").publicState, "inactive");
    assert.ok(timer);
    now = Date.parse("2026-08-02T00:00:00Z");
    const opening = timer.callback;
    timer = null;
    opening();
    assert.equal(service.getCapability("week-a").publicState, "active");
    now = Date.parse("2026-08-03T00:00:00Z");
    const closing = timer.callback;
    timer = null;
    closing();
    assert.equal(service.getCapability("week-a").publicState, "closed");
    assert.equal(timer, null);
    service.stop();
  });
});

test("freshness separa cache usable de cache fresca sin TTL destructivo", async () => {
  await withTempDir(async (userDataDir) => {
    let now = Date.parse("2026-08-01T00:02:00Z");
    let requests = 0;
    let serverState = "active";
    let fail = false;
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const cache = require("../src/competitive-authority-cache").createWeekCapabilityCache({ userDataDir });
    await cache.initialize();
    await cache.remember({ deploymentKey: "build-a:production:1", origin: "https://hsl.example" }, {
      checkedAt: "2026-08-01T00:01:30Z",
      conclusive: true,
      publicState: "inactive",
      reason: "week-inactive",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    const service = createWeekCapabilitiesService({
      cache,
      fetchImpl: async (_url, init) => {
        requests += 1;
        if (fail) throw new Error("transport");
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => ({
          requestKey: request.requestKey,
          weekId: request.weekId,
          seasonId: "season-a",
          derivedStatus: serverState,
          publicState: serverState,
          rawStatus: serverState,
          reason: `week-${serverState}`,
        })), new Date(now).toISOString());
      },
      getConnectivityState: () => connection,
      now: () => now,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });

    assert.equal(service.getCapability("week-a").usable, true);
    assert.equal(service.getCapability("week-a").fresh, true);
    await service.refresh("fresh");
    assert.equal(requests, 0);

    now += 31_000;
    assert.equal(service.getCapability("week-a").fresh, false);
    await service.refresh("stale");
    assert.equal(requests, 1);
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getCapability("week-a").fresh, true);

    serverState = "closed";
    await service.refresh("force", { force: true });
    assert.equal(requests, 2);
    assert.equal(service.getCapability("week-a").publicState, "closed");

    fail = true;
    now += 61_000;
    await service.refresh("failure");
    assert.equal(requests, 3);
    assert.equal(service.getCapability("week-a").publicState, "closed");
    assert.equal(service.getCapability("week-a").checkedAt, "2026-08-01T00:02:31.000Z");

    connection.reachability = "offline";
    now += 61_000;
    await service.refresh("offline");
    assert.equal(requests, 3);
    assert.equal(service.getCapability("week-a").usable, true);
    assert.equal(service.getCapability("week-a").fresh, false);
    service.stop();
  });
});

test("arranque conectado reemplaza ACTIVE durable antigua por CLOSED remota", async () => {
  await withTempDir(async (userDataDir) => {
    const now = Date.parse("2026-08-01T00:10:00Z");
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const cache = require("../src/competitive-authority-cache").createWeekCapabilityCache({ userDataDir });
    await cache.initialize();
    await cache.remember({ deploymentKey: "build-a:production:1", origin: "https://hsl.example" }, {
      checkedAt: "2026-08-01T00:00:00Z",
      conclusive: true,
      publicState: "active",
      reason: "week-active",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    const service = createWeekCapabilitiesService({
      cache,
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => ({
          requestKey: request.requestKey,
          weekId: request.weekId,
          seasonId: "season-a",
          derivedStatus: "closed",
          publicState: "closed",
          rawStatus: "closed",
          reason: "week-closed",
        })), new Date(now).toISOString());
      },
      getConnectivityState: () => connection,
      now: () => now,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    assert.equal(service.getCapability("week-a").publicState, "active");
    await service.refresh("startup");
    assert.equal(service.getCapability("week-a").publicState, "closed");
    service.stop();
  });
});

test("preflight forzado distingue respuesta concluyente de fallo temporal", async () => {
  await withTempDir(async (userDataDir) => {
    let fail = false;
    let requests = 0;
    const now = Date.parse("2026-08-01T00:10:00Z");
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: async (_url, init) => {
        requests += 1;
        if (fail) throw new Error("transport");
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => ({
          requestKey: request.requestKey,
          weekId: request.weekId,
          seasonId: "season-a",
          derivedStatus: "active",
          publicState: "active",
          rawStatus: "active",
          reason: "week-active",
        })), new Date(now).toISOString());
      },
      getConnectivityState: () => connection,
      now: () => now,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const active = await service.ensureFreshCapability("week-a");
    assert.equal(active.ok, true);
    assert.equal(active.capability.publicState, "active");
    fail = true;
    const failed = await service.ensureFreshCapability("week-a");
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, "temporary-failure");
    assert.equal(failed.capability.publicState, "active");
    assert.equal(requests, 2);
    service.stop();
  });
});

test("preflight timeout usa reloj falso, bloquea online y limpia su timer", async () => {
  await withTempDir(async (userDataDir) => {
    let timeoutCallback = null;
    let cleared = 0;
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      clearTimeout: () => { cleared += 1; timeoutCallback = null; },
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
      getConnectivityState: () => connection,
      now: () => Date.parse("2026-08-01T00:10:00Z"),
      setTimeout: (callback) => { timeoutCallback = callback; return 1; },
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const pending = service.ensureFreshCapability("week-a");
    assert.equal(typeof timeoutCallback, "function");
    timeoutCallback();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.reason, "timeout");
    assert.equal(cleared, 1);
    assert.equal(service.getDiagnostics().inFlight, false);
    service.stop();
  });
});

test("preflight acepta respuestas concluyentes ACTIVE, CLOSED e INACTIVE y conserva el estado", async (t) => {
  for (const publicState of ["active", "closed", "inactive"]) {
    await t.test(publicState, async () => withTempDir(async (userDataDir) => {
      const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
      const service = createWeekCapabilitiesService({
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(init.body);
          return response(payload.requests.map((request) => resultFor(request, publicState)));
        },
        getConnectivityState: () => connection,
        now: () => Date.parse("2026-08-01T00:00:00Z"),
        userDataDir,
      });
      await service.initialize();
      service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
      const result = await service.ensureFreshCapability("week-a");
      assert.equal(result.ok, true);
      assert.equal(result.status, "updated");
      assert.equal(result.capability.publicState, publicState);
      service.stop();
    }));
  }
});

test("HTTP 404 y 503 conservan status, reason y diagnostico sin aceptar ACTIVE cacheada", async (t) => {
  for (const status of [404, 503]) {
    await t.test(String(status), async () => withTempDir(async (userDataDir) => {
      const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
      const cache = require("../src/competitive-authority-cache").createWeekCapabilityCache({ userDataDir });
      await cache.initialize();
      await cache.remember({ deploymentKey: "build-a:production:1", origin: "https://hsl.example" }, {
        checkedAt: "2026-08-01T00:00:00Z",
        conclusive: true,
        publicState: "active",
        reason: "week-active",
        weekId: "week-a",
      });
      const service = createWeekCapabilitiesService({
        cache,
        fetchImpl: async () => new Response("unavailable", { status, headers: { "content-type": "text/plain" } }),
        getConnectivityState: () => connection,
        now: () => Date.parse("2026-08-01T00:10:00Z"),
        userDataDir,
      });
      await service.initialize();
      service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
      const result = await service.ensureFreshCapability("week-a");
      const diagnostics = service.getDiagnostics();
      assert.equal(result.ok, false);
      assert.equal(result.reason, `http-${status}`);
      assert.equal(result.capability.publicState, "active");
      assert.equal(diagnostics.lastRequest.httpStatus, status);
      assert.equal(diagnostics.lastRequest.reason, `http-${status}`);
      assert.equal(diagnostics.lastRequest.result, "failed");
      service.stop();
    }));
  }
});

test("JSON, version y resultados incompletos fallan con motivos sanitizados", async (t) => {
  const cases = [
    {
      expected: "invalid-json",
      name: "invalid-json",
      response: () => new Response("not-json", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-hsl-build": "build-a",
          "x-hsl-environment": "production",
          "x-hsl-launcher-api-version": "1",
        },
      }),
    },
    {
      expected: "invalid-response",
      name: "contract-version",
      response: (request) => response([resultFor(request)], undefined, deployment, 2),
    },
    {
      expected: "invalid-response",
      name: "missing-week",
      response: () => response([]),
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => withTempDir(async (userDataDir) => {
      const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
      const service = createWeekCapabilitiesService({
        fetchImpl: async (_url, init) => fixture.response(JSON.parse(init.body).requests[0]),
        getConnectivityState: () => connection,
        userDataDir,
      });
      await service.initialize();
      service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
      const result = await service.ensureFreshCapability("week-a");
      assert.equal(result.ok, false);
      assert.equal(result.reason, fixture.expected);
      assert.equal(service.getDiagnostics().lastRequest.contractValidation, "invalid");
      service.stop();
    }));
  }
});

test("health stale reproduce deployment-mismatch y una huella resincronizada acepta ACTIVE", async () => {
  await withTempDir(async (userDataDir) => {
    const currentDeployment = { apiVersion: 1, build: "build-b", environment: "production" };
    const connection = { deployment: { ...deployment }, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request)), undefined, currentDeployment);
      },
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });

    const staleHealth = await service.ensureFreshCapability("week-a");
    assert.equal(staleHealth.ok, false);
    assert.equal(staleHealth.reason, "deployment-mismatch");
    assert.equal(service.getDiagnostics().lastRequest.deploymentMatch, false);

    connection.deployment = currentDeployment;
    service.updateDeployment();
    const resynchronized = await service.ensureFreshCapability("week-a");
    assert.equal(resynchronized.ok, true);
    assert.equal(resynchronized.capability.publicState, "active");
    assert.equal(service.getDiagnostics().lastRequest.deploymentMatch, true);
    service.stop();
  });
});

test("single-flight de la misma week entrega al preflight el resultado del run compartido", async () => {
  await withTempDir(async (userDataDir) => {
    let resolveFetch;
    let requests = 0;
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: (_url, init) => {
        requests += 1;
        const payload = JSON.parse(init.body);
        return new Promise((resolve) => {
          resolveFetch = () => resolve(response(payload.requests.map((request) => resultFor(request))));
        });
      },
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const background = service.refresh("background", { force: true });
    const preflight = service.ensureFreshCapability("week-a");
    assert.equal(requests, 1);
    resolveFetch();
    await background;
    const result = await preflight;
    assert.equal(result.ok, true);
    assert.equal(result.requestRunId, 1);
    assert.equal(requests, 1);
    service.stop();
  });
});

test("single-flight de otra week espera y crea un run propio sin robar identidad", async () => {
  await withTempDir(async (userDataDir) => {
    const pending = [];
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: (_url, init) => {
        const payload = JSON.parse(init.body);
        return new Promise((resolve) => pending.push({
          ids: payload.requests.map((request) => request.weekId),
          resolve: () => resolve(response(payload.requests.map((request) => resultFor(request)))),
        }));
      },
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }, { weekId: "week-b" }], webBaseUrl: "https://hsl.example" });
    const background = service.refresh("background", { force: true, weekIds: ["week-a"] });
    const preflight = service.ensureFreshCapability("week-b");
    assert.deepEqual(pending[0].ids, ["week-a"]);
    pending[0].resolve();
    await background;
    await Promise.resolve();
    assert.deepEqual(pending[1].ids, ["week-b"]);
    pending[1].resolve();
    const result = await preflight;
    assert.equal(result.ok, true);
    assert.equal(result.requestRunId, 2);
    service.stop();
  });
});

test("un cambio real de contexto queda stale pero una revision tecnica equivalente no", async (t) => {
  await t.test("context-change", async () => withTempDir(async (userDataDir) => {
    let resolveFetch;
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: (_url, init) => {
        const payload = JSON.parse(init.body);
        return new Promise((resolve) => { resolveFetch = () => resolve(response(payload.requests.map((request) => resultFor(request)))); });
      },
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const preflight = service.ensureFreshCapability("week-a");
    service.updateContext({ packs: [{ weekId: "week-b" }], webBaseUrl: "https://hsl.example" });
    resolveFetch();
    const result = await preflight;
    assert.equal(result.ok, false);
    assert.equal(result.reason, "stale-context");
    service.stop();
  }));

  await t.test("equivalent-technical-refresh", async () => withTempDir(async (userDataDir) => {
    let resolveFetch;
    const connection = { deployment, deploymentGeneration: 1, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: (_url, init) => {
        const payload = JSON.parse(init.body);
        return new Promise((resolve) => { resolveFetch = () => resolve(response(payload.requests.map((request) => resultFor(request)))); });
      },
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const preflight = service.ensureFreshCapability("week-a");
    connection.deployment = { ...deployment };
    connection.deploymentGeneration = 2;
    service.updateDeployment();
    resolveFetch();
    const result = await preflight;
    assert.equal(result.ok, true);
    service.stop();
  }));
});
