const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWeekCapabilitiesService } = require("../src/week-capabilities-service");
const { createWeekCapabilityCache } = require("../src/competitive-authority-cache");
const { deriveCompetitionAccess } = require("../src/competition-access");

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-week-service-"));
  try { return await run(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

const deployment = { apiVersion: 1, build: "build-a", environment: "production" };
function response(results, generatedAt = "2026-08-01T00:00:00.000Z", responseDeployment = deployment, version = 1, headerDeployment = responseDeployment) {
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
      "x-hsl-build": headerDeployment.build,
      "x-hsl-environment": headerDeployment.environment,
      "x-hsl-launcher-api-version": String(headerDeployment.apiVersion),
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

function createFakeClock(initialNow) {
  let current = initialNow;
  let nextId = 0;
  const timers = new Map();
  return {
    clearTimeout(id) { timers.delete(id); },
    now() { return current; },
    pendingCount() { return timers.size; },
    setTimeout(callback, delay = 0) {
      const id = ++nextId;
      timers.set(id, { at: current + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    async runNext() {
      const next = [...timers.entries()].sort((left, right) => left[1].at - right[1].at)[0];
      assert.ok(next, "expected a scheduled timer");
      const [id, timer] = next;
      timers.delete(id);
      current = Math.max(current, timer.at);
      timer.callback();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

async function settleService(service) {
  for (let index = 0; index < 20 && service.getDiagnostics().inFlight; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(service.getDiagnostics().inFlight, false);
}

function createMemoryWeekCache(initialCapability) {
  let capability = { ...initialCapability };
  return {
    path: null,
    async initialize() { return {}; },
    async remember(_context, next) { capability = { ...next }; return capability; },
    read(_context, weekId) {
      if (!capability || capability.weekId !== weekId) return null;
      return {
        ...capability,
        canPlayCompetition: capability.publicState === "active",
        confirmedPublicState: capability.publicState,
        lastKnownPublicState: capability.publicState,
        nextBoundaryAt: null,
        source: "durable-cache",
      };
    },
  };
}

async function seedWeekCache(cache, weekId, publicState, checkedAt = "2026-08-01T00:00:00.000Z") {
  await cache.remember({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, {
    checkedAt,
    conclusive: true,
    derivedStatus: publicState,
    publicState,
    rawStatus: publicState,
    reason: `week-${publicState}`,
    seasonId: "season-a",
    seasonStatus: "active",
    weekId,
  });
}

test("cache-first hidrata el mismo deployment y conserva ACTIVE/UNLINKED tras refresh", async () => {
  await withTempDir(async (userDataDir) => {
    const now = Date.parse("2026-08-01T00:02:00.000Z");
    const cache = createWeekCapabilityCache({ userDataDir });
    await cache.initialize();
    await seedWeekCache(cache, "week-a", "active");
    await seedWeekCache(cache, "week-unlinked", "unlinked");
    const originalKeys = cache.snapshot().entries.map((entry) => entry.key).sort();
    const connection = {
      deployment: {},
      reachability: "connecting",
      reachabilityGeneration: 0,
    };
    const transitions = [];
    const service = createWeekCapabilitiesService({
      cache,
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(
          request,
          request.weekId === "week-unlinked" ? "unlinked" : "active",
        )), new Date(now).toISOString());
      },
      getConnectivityState: () => connection,
      now: () => now,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({
      packs: [{ weekId: "week-a" }, { weekId: "week-unlinked" }],
      webBaseUrl: "https://hsl.example",
    });
    const startupGeneration = service.getState().generation;
    const cacheFirst = service.getDiagnostics();
    assert.equal(cacheFirst.context.authorityKey, "launcher-api:1");
    assert.equal(cacheFirst.deployment.metadata.build, "unknown");
    assert.equal(service.getCapability("week-a").publicState, "unknown");
    assert.equal(service.getCapability("week-a").lastKnownPublicState, "active");
    service.subscribe((_state, reason) => transitions.push(reason));

    connection.deployment = { ...deployment };
    connection.reachability = "connected";
    connection.reachabilityGeneration = 1;
    service.updateDeployment();
    const hydrated = service.getDiagnostics();
    assert.equal(service.getState().generation, startupGeneration);
    assert.deepEqual(hydrated.deployment.metadata, deployment);
    assert.deepEqual(cache.snapshot().entries.map((entry) => entry.key).sort(), originalKeys);
    assert.equal(transitions.includes("context-change"), false);

    await service.refresh("startup", { force: true });
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getCapability("week-a").currentAuthority, true);
    assert.equal(service.getCapability("week-unlinked").publicState, "unlinked");
    assert.equal(service.getCapability("week-unlinked").currentAuthority, true);
    assert.equal(cache.read({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, "week-a", now).checkedAt, "2026-08-01T00:02:00.000Z");
    assert.deepEqual(cache.snapshot().entries.map((entry) => entry.key).sort(), originalKeys);
    assert.equal(service.getDiagnostics().lastRequest.contractCompatible, true);
    assert.deepEqual(service.getDiagnostics().lastRequest.healthDeployment, deployment);

    connection.activity = "blurred";
    service.updateDeployment();
    connection.activity = "focused";
    service.updateContext({
      packs: [{ weekId: "week-a" }, { weekId: "week-unlinked" }],
      webBaseUrl: "https://hsl.example",
    });
    assert.equal(service.getState().generation, startupGeneration);
    assert.equal(service.getCapability("week-a").publicState, "active");
    service.stop();
  });
});

test("health-first converge con autoridad estable y metadata diagnóstica", async () => {
  await withTempDir(async (userDataDir) => {
    const connection = { deployment: { ...deployment }, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request, "active")));
      },
      getConnectivityState: () => connection,
      now: () => Date.parse("2026-08-01T00:02:00.000Z"),
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const generation = service.getState().generation;
    await service.refresh("startup", { force: true });
    assert.equal(service.getState().generation, generation);
    assert.equal(service.getDiagnostics().context.authorityKey, "launcher-api:1");
    assert.deepEqual(service.getDiagnostics().lastRequest.healthDeployment, deployment);
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getCapability("week-a").currentAuthority, true);
    service.stop();
  });
});

test("una segunda apertura reutiliza cache, hidrata health same-key y renueva checkedAt", async () => {
  await withTempDir(async (userDataDir) => {
    const firstConnection = { deployment: { ...deployment }, reachability: "connected", reachabilityGeneration: 1 };
    const fetchImpl = async (_url, init) => {
      const payload = JSON.parse(init.body);
      return response(payload.requests.map((request) => resultFor(request, "active")));
    };
    const first = createWeekCapabilitiesService({
      fetchImpl,
      getConnectivityState: () => firstConnection,
      now: () => Date.parse("2026-08-01T00:00:00.000Z"),
      userDataDir,
    });
    await first.initialize();
    first.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    await first.refresh("first-open", { force: true });
    first.stop();

    const secondConnection = { deployment: {}, reachability: "connecting", reachabilityGeneration: 0 };
    const second = createWeekCapabilitiesService({
      fetchImpl,
      getConnectivityState: () => secondConnection,
      now: () => Date.parse("2026-08-01T00:02:00.000Z"),
      userDataDir,
    });
    await second.initialize();
    second.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const generation = second.getState().generation;
    assert.equal(second.getDiagnostics().context.authorityKey, "launcher-api:1");
    secondConnection.deployment = { ...deployment };
    secondConnection.reachability = "connected";
    secondConnection.reachabilityGeneration = 1;
    second.updateDeployment();
    const refreshed = await second.ensureFreshCapability("week-a");
    assert.equal(refreshed.ok, true);
    assert.equal(second.getState().generation, generation);
    assert.equal(refreshed.capability.checkedAt, "2026-08-01T00:02:00.000Z");
    assert.equal(refreshed.capability.publicState, "active");
    second.stop();
  });
});

test("runRefresh bloquea una API sin confirmar pero no exige build", async () => {
  await withTempDir(async (userDataDir) => {
    let requests = 0;
    const cache = createWeekCapabilityCache({ userDataDir });
    await cache.initialize();
    await seedWeekCache(cache, "week-a", "active");
    const connection = { deployment: {}, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      cache,
      fetchImpl: async (_url, init) => {
        requests += 1;
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request, "active")));
      },
      getConnectivityState: () => connection,
      now: () => Date.parse("2026-08-01T00:02:00.000Z"),
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const blocked = await service.ensureFreshCapability("week-a");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "unsupported-contract");
    assert.equal(requests, 0);

    const generation = service.getState().generation;
    connection.deployment = { ...deployment };
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    assert.equal(service.getDiagnostics().context.authorityKey, "launcher-api:1");
    const recovered = await service.ensureFreshCapability("week-a");
    assert.equal(recovered.ok, true);
    assert.equal(requests, 1);
    assert.equal(service.getState().generation, generation);
    assert.equal(recovered.capability.publicState, "active");
    service.stop();
  });
});

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

test("una respuesta in-flight compatible sobrevive build/environment change", async () => {
  await withTempDir(async (userDataDir) => {
    let resolveFetch;
    let aborted = 0;
    const connection = { deployment, deploymentGeneration: 1, reachability: "connected", reachabilityGeneration: 1 };
    const service = createWeekCapabilitiesService({
      fetchImpl: (_url, init) => new Promise((resolve) => {
        init.signal.addEventListener("abort", () => { aborted += 1; }, { once: true });
        resolveFetch = resolve;
      }),
      getConnectivityState: () => connection,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const generationA = service.getState().generation;
    const pending = service.refresh("stale");
    const deploymentB = { apiVersion: 1, build: "build-b", environment: "production" };
    connection.deployment = deploymentB;
    connection.deploymentGeneration = 2;
    service.updateDeployment();
    assert.equal(service.getState().generation, generationA);
    assert.equal(aborted, 0);
    resolveFetch(response([{
      requestKey: "week-0",
      weekId: "week-a",
      seasonId: "season-a",
      derivedStatus: "active",
      publicState: "active",
      reason: "week-active",
    }], undefined, deploymentB));
    await pending;
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getDiagnostics().lastAttemptResult, "updated");
    assert.deepEqual(service.getDiagnostics().deployment.metadata, deploymentB);
    assert.equal(service.getDiagnostics().lastRequest.metadataMatchesHealth, false);
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
    await cache.remember({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, {
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
    await cache.remember({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, {
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
    assert.equal(service.getCapability("week-a").publicState, "unknown");
    assert.equal(service.getCapability("week-a").lastKnownPublicState, "closed");
    assert.equal(service.getCapability("week-a").authorityState, "stale-error");
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
    await cache.remember({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, {
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
    assert.equal(service.getCapability("week-a").publicState, "unknown");
    assert.equal(service.getCapability("week-a").lastKnownPublicState, "active");
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
    assert.ok(cleared >= 1);
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
      await cache.remember({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, {
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
      assert.equal(result.capability.publicState, "unknown");
      assert.equal(result.capability.lastKnownPublicState, "active");
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
      expected: "unsupported-contract",
      name: "launcher-api-header-version",
      response: (request) => response([resultFor(request)], undefined, deployment, 1, {
        apiVersion: 2,
        build: "build-b",
        environment: "production",
      }),
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

test("Health build A acepta Week build B y header/body con metadata distinta", async () => {
  await withTempDir(async (userDataDir) => {
    const currentDeployment = { apiVersion: 1, build: "build-b", environment: "production" };
    const headerDeployment = { apiVersion: 1, build: "edge-build", environment: "preview" };
    const connection = { deployment: { ...deployment }, reachability: "connected", reachabilityGeneration: 1 };
    let requests = 0;
    const service = createWeekCapabilitiesService({
      fetchImpl: async (_url, init) => {
        requests += 1;
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request)), undefined, currentDeployment, 1,
          requests === 1 ? currentDeployment : headerDeployment);
      },
      getConnectivityState: () => connection,
      now: () => Date.parse("2026-08-01T00:00:00Z"),
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });

    const rolling = await service.ensureFreshCapability("week-a");
    assert.equal(rolling.ok, true);
    assert.equal(rolling.capability.publicState, "active");
    assert.equal(service.getDiagnostics().lastRequest.contractCompatible, true);
    assert.equal(service.getDiagnostics().lastRequest.metadataMatchesHealth, false);

    const splitMetadata = await service.ensureFreshCapability("week-a");
    assert.equal(splitMetadata.ok, true);
    assert.equal(service.getDiagnostics().lastRequest.metadataMatchesHeaders, false);
    assert.equal(service.getCapability("week-a").publicState, "active");
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

test("CLOSED durable converge automaticamente a ACTIVE sin focus, restart ni interacción", async () => {
  await withTempDir(async (userDataDir) => {
    const clock = createFakeClock(Date.parse("2026-08-01T12:00:00Z"));
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const cache = createMemoryWeekCache({
      checkedAt: "2026-08-01T11:00:00Z",
      conclusive: true,
      derivedStatus: "closed",
      finalDeadlineAt: "2026-07-31T00:00:00Z",
      publicFreezeAt: "2026-07-30T00:00:00Z",
      publicStartAt: "2026-07-01T00:00:00Z",
      publicState: "closed",
      rawStatus: "closed",
      reason: "week-closed",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    const observed = [];
    const service = createWeekCapabilitiesService({
      cache,
      clearTimeout: clock.clearTimeout,
      config: { maxAgeMs: 100, requestTimeoutMs: 1_000, retryBaseMs: 10, retryMaxMs: 40 },
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request, "active")), new Date(clock.now()).toISOString());
      },
      getConnectivityState: () => connection,
      now: clock.now,
      setTimeout: clock.setTimeout,
      userDataDir,
    });
    await service.initialize();
    service.subscribe((state, reason) => observed.push({ capability: state.entries["week-a"], reason }));
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });

    assert.equal(service.getCapability("week-a").publicState, "unknown");
    assert.equal(service.getCapability("week-a").lastKnownPublicState, "closed");
    await clock.runNext();
    await settleService(service);
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getCapability("week-a").fresh, true);
    const access = deriveCompetitionAccess({
      local: { canCapture: true, canPractice: true, canSubmitLocally: true, hasCompetitionScope: true, hasWeek: true },
      membership: { canSubmit: true, status: "member" },
      session: { hasSession: true, remoteUsable: true, requiresLogin: false, userId: "user-a" },
      week: service.getCapability("week-a"),
    });
    assert.equal(access.canPlayCompetition, true);
    assert.equal(access.reason, "competition-ready");
    const refreshStart = observed.find((item) => item.reason === "freshness-expired:start");
    assert.equal(refreshStart.capability.publicState, "closed");
    assert.equal(refreshStart.capability.authorityState, "refreshing");
    service.stop();
  });
});

test("un fallo con CLOSED stale programa backoff y el retry automático converge a ACTIVE", async () => {
  await withTempDir(async (userDataDir) => {
    const clock = createFakeClock(Date.parse("2026-08-01T12:00:00Z"));
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const cache = createMemoryWeekCache({
      checkedAt: "2026-08-01T11:00:00Z",
      conclusive: true,
      derivedStatus: "closed",
      finalDeadlineAt: "2026-07-31T00:00:00Z",
      publicFreezeAt: "2026-07-30T00:00:00Z",
      publicStartAt: "2026-07-01T00:00:00Z",
      publicState: "closed",
      rawStatus: "closed",
      reason: "week-closed",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    let attempts = 0;
    const service = createWeekCapabilitiesService({
      cache,
      clearTimeout: clock.clearTimeout,
      config: { maxAgeMs: 100, requestTimeoutMs: 1_000, retryBaseMs: 10, retryMaxMs: 40 },
      fetchImpl: async (_url, init) => {
        attempts += 1;
        if (attempts === 1) throw new Error("transport");
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request, "active")), new Date(clock.now()).toISOString());
      },
      getConnectivityState: () => connection,
      now: clock.now,
      setTimeout: clock.setTimeout,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });

    await clock.runNext();
    await settleService(service);
    const stale = service.getCapability("week-a");
    const failedDiagnostics = service.getDiagnostics();
    assert.equal(stale.publicState, "unknown");
    assert.equal(stale.lastKnownPublicState, "closed");
    assert.equal(stale.authorityState, "stale-error");
    assert.equal(failedDiagnostics.lastFailureReason, "temporary-failure");
    assert.equal(failedDiagnostics.lastAttemptTrigger, "freshness-expired");
    assert.equal(failedDiagnostics.lastAttemptResult, "failed");
    assert.ok(failedDiagnostics.retryScheduledAt);
    assert.deepEqual({
      authorityState: failedDiagnostics.capabilities["week-a"].authorityState,
      checkedAt: failedDiagnostics.capabilities["week-a"].checkedAt,
      conclusive: failedDiagnostics.capabilities["week-a"].conclusive,
      derivedStatus: failedDiagnostics.capabilities["week-a"].derivedStatus,
      fresh: failedDiagnostics.capabilities["week-a"].fresh,
      lastKnownPublicState: failedDiagnostics.capabilities["week-a"].lastKnownPublicState,
      publicState: failedDiagnostics.capabilities["week-a"].publicState,
      rawStatus: failedDiagnostics.capabilities["week-a"].rawStatus,
      source: failedDiagnostics.capabilities["week-a"].source,
    }, {
      authorityState: "stale-error",
      checkedAt: "2026-08-01T11:00:00Z",
      conclusive: true,
      derivedStatus: "closed",
      fresh: false,
      lastKnownPublicState: "closed",
      publicState: "unknown",
      rawStatus: "closed",
      source: "durable-cache",
    });

    await clock.runNext();
    await settleService(service);
    assert.equal(attempts, 2);
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getDiagnostics().retryScheduledAt, null);
    service.stop();
  });
});

test("ACTIVE durable converge automaticamente a CLOSED al caducar", async () => {
  await withTempDir(async (userDataDir) => {
    const clock = createFakeClock(Date.parse("2026-08-01T12:00:00Z"));
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const cache = createMemoryWeekCache({
      checkedAt: "2026-08-01T11:00:00Z",
      conclusive: true,
      publicState: "active",
      reason: "week-active",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    const service = createWeekCapabilitiesService({
      cache,
      clearTimeout: clock.clearTimeout,
      config: { maxAgeMs: 100, requestTimeoutMs: 1_000 },
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request, "closed")), new Date(clock.now()).toISOString());
      },
      getConnectivityState: () => connection,
      now: clock.now,
      setTimeout: clock.setTimeout,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    await clock.runNext();
    await settleService(service);
    assert.equal(service.getCapability("week-a").publicState, "closed");
    assert.equal(service.getCapability("week-a").authorityState, "fresh-confirmed");
    service.stop();
  });
});

test("suspend cancela el scheduler y resume lo rearma sin polling", async () => {
  await withTempDir(async (userDataDir) => {
    const clock = createFakeClock(Date.parse("2026-08-01T12:00:00Z"));
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 1 };
    const cache = createMemoryWeekCache({
      checkedAt: "2026-08-01T11:00:00Z",
      conclusive: true,
      publicState: "closed",
      reason: "week-closed",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    const service = createWeekCapabilitiesService({
      cache,
      clearTimeout: clock.clearTimeout,
      config: { maxAgeMs: 100, requestTimeoutMs: 1_000 },
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return response(payload.requests.map((request) => resultFor(request, "active")), new Date(clock.now()).toISOString());
      },
      getConnectivityState: () => connection,
      now: clock.now,
      setTimeout: clock.setTimeout,
      userDataDir,
    });
    await service.initialize();
    service.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    assert.equal(clock.pendingCount(), 1);

    service.setSuspended(true);
    assert.equal(clock.pendingCount(), 0);
    assert.equal(service.getDiagnostics().suspended, true);

    service.setSuspended(false);
    assert.equal(clock.pendingCount(), 1);
    await clock.runNext();
    await settleService(service);
    assert.equal(service.getCapability("week-a").publicState, "active");
    assert.equal(service.getDiagnostics().suspended, false);
    service.stop();
  });
});
