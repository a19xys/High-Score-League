const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runCompetitionPlayPreflight } = require("../src/competition-play-preflight");
const {
  launcherAuthorityKey,
  launcherContractsCompatible,
} = require("../src/deployment-fingerprint");
const { createRankingCapabilitiesService } = require("../src/ranking-capabilities-service");
const { createWeekCapabilityCache } = require("../src/competitive-authority-cache");
const { createWeekCapabilitiesService } = require("../src/week-capabilities-service");

function endpointResponse(body, metadata) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-hsl-build": metadata.build,
      "x-hsl-environment": metadata.environment,
      "x-hsl-launcher-api-version": String(metadata.apiVersion),
    },
  });
}

test("authorityKey deriva solo de la versión contractual soportada", () => {
  assert.equal(launcherAuthorityKey(), "launcher-api:1");
  assert.equal(launcherAuthorityKey(1), "launcher-api:1");
  assert.equal(launcherContractsCompatible(
    { apiVersion: 1, build: "build-a", environment: "production" },
    { apiVersion: 1, build: "build-b", environment: "preview" },
  ), true);
  assert.equal(launcherContractsCompatible({ apiVersion: 2, build: "build-a", environment: "production" }), false);
});

test("rolling deployment integrado acepta Week/Ranking in-flight y no bloquea Jugar", async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-rolling-authority-"));
  const buildA = { apiVersion: 1, build: "build-a", environment: "production" };
  const buildB = { apiVersion: 1, build: "build-b", environment: "preview" };
  const connection = {
    deployment: buildA,
    deploymentGeneration: 1,
    reachability: "connected",
    reachabilityGeneration: 7,
  };
  let resolveRanking;
  let resolveWeek;
  let launches = 0;
  const weekCache = createWeekCapabilityCache({ userDataDir });
  const week = createWeekCapabilitiesService({
    cache: weekCache,
    fetchImpl: (_url, init) => new Promise((resolve) => {
      const request = JSON.parse(init.body).requests[0];
      resolveWeek = () => resolve(endpointResponse({
        version: 1,
        build: buildB.build,
        environment: buildB.environment,
        results: [{
          derivedStatus: "active",
          publicState: "active",
          reason: "week-active",
          requestKey: request.requestKey,
          seasonId: "season-a",
          seasonStatus: "active",
          weekId: request.weekId,
        }],
      }, buildB));
    }),
    getConnectivityState: () => connection,
    userDataDir,
  });
  const ranking = createRankingCapabilitiesService({
    fetchImpl: (_url, init) => new Promise((resolve) => {
      const request = JSON.parse(init.body).requests[0];
      resolveRanking = () => resolve(endpointResponse({
        version: 1,
        build: buildB.build,
        environment: buildB.environment,
        results: [{
          reason: "public-week",
          requestKey: request.requestKey,
          status: "available",
          url: "https://hsl.example/weeks/week-a",
        }],
      }, buildB));
    }),
    getConnectivityState: () => connection,
  });

  try {
    await week.initialize();
    week.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    ranking.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: "https://hsl.example" });
    const weekGeneration = week.getState().generation;
    const rankingGeneration = ranking.getState().generation;
    const rankingRequest = ranking.refresh("rolling-deployment");
    const preflight = runCompetitionPlayPreflight({
      ensureFreshCapability: (weekId) => week.ensureFreshCapability(weekId),
      getAuthorityContext: () => ({
        ...week.getAuthorityContext(),
        connected: true,
        deployment: connection.deployment,
        reachabilityGeneration: connection.reachabilityGeneration,
      }),
      getState: async () => {
        const weekCapability = week.getCapability("week-a");
        return {
          competitionAccess: { canPlayCompetition: weekCapability.publicState === "active" },
          game: { weekId: "week-a" },
          membership: { effectiveStatus: "member", status: "member" },
          readiness: { canPlayCompetition: weekCapability.publicState === "active", canPractice: true },
          selection: { activeInstanceKey: "pack-a" },
          session: { hasSession: true, userId: "user-a" },
          weekCapability,
        };
      },
      launch: async () => { launches += 1; return { ok: true }; },
    });
    await new Promise((resolve) => setImmediate(resolve));

    connection.deployment = buildB;
    connection.deploymentGeneration = 2;
    week.updateDeployment();
    ranking.updateDeployment();
    assert.equal(week.getState().generation, weekGeneration);
    assert.equal(ranking.getState().generation, rankingGeneration);

    resolveWeek();
    resolveRanking();
    const [playResult] = await Promise.all([preflight, rankingRequest]);
    assert.equal(playResult.ok, true);
    assert.equal(launches, 1);
    assert.equal(week.getCapability("week-a").publicState, "active");
    assert.equal(ranking.getCapability("week-a").status, "available");
    assert.equal(week.getDiagnostics().lastRequest.metadataMatchesHealth, false);
    assert.equal(ranking.getDiagnostics().lastRequest.metadataMatchesHealth, false);
    assert.equal(weekCache.snapshot().entries[0].key, "https://hsl.example|launcher-api:1|week:week-a");
  } finally {
    week.stop();
    ranking.stop();
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }
});
