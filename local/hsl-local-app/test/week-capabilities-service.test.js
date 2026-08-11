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
function response(results, generatedAt = "2026-08-01T00:00:00.000Z") {
  return new Response(JSON.stringify({ version: 1, build: "build-a", environment: "production", generatedAt, results }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-hsl-build": "build-a",
      "x-hsl-environment": "production",
      "x-hsl-launcher-api-version": "1",
    },
  });
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
