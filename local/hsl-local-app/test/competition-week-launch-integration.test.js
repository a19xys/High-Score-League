const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runCompetitionPlayPreflight } = require("../src/competition-play-preflight");
const { createWeekCapabilityCache } = require("../src/competitive-authority-cache");
const { createWeekCapabilitiesService } = require("../src/week-capabilities-service");
const { launchMameDetailed } = require("../src/mame-launcher");
const { prepareV2CompetitionRun } = require("../src/mame-plugin-run");
const { writeCompetitionManifest } = require("../src/competition-manifest");
const { loadPackFromDir } = require("../src/pack");

async function writeFile(filePath, contents = "") {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, contents, "utf8");
}

test("Space Invaders visible ACTIVE confirma endpoint, prepara v2 y alcanza ChildProcess spawn", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-competition-launch-"));
  const originalLog = console.log;
  console.log = () => {};
  try {
    const userDataDir = path.join(root, "userData");
    const packRoot = path.join(root, "Space Invaders");
    const romDir = path.join(packRoot, "roms");
    const adapterPath = path.join(packRoot, "scripts", "invaders.lua");
    const runtimeRoot = path.join(root, "runtime", "mame");
    const sourceDir = path.join(root, "app-plugin", "hsl-score");
    await Promise.all([
      writeFile(path.join(romDir, "invaders.zip"), "fixture-rom"),
      writeFile(adapterPath, "return { read_memory = function() end, build_event = function() end }"),
      writeFile(path.join(runtimeRoot, "mame.exe"), "fixture-executable"),
      writeFile(path.join(runtimeRoot, "plugins", "boot.lua"), "return {}"),
      writeFile(path.join(sourceDir, "init.lua"), "return {}"),
      writeFile(path.join(sourceDir, "plugin.json"), JSON.stringify({ plugin: { version: "0.3.0" } })),
      writeFile(path.join(sourceDir, "core", "config.lua"), "return {}"),
      writeFile(path.join(sourceDir, "games", "invaders.lua"), "return {}"),
    ]);
    await writeFile(path.join(packRoot, "pack.json"), `${JSON.stringify({
      packVersion: 2,
      packId: "space-invaders-dev-pack-v2",
      gameId: "space-invaders",
      rom: "invaders",
      seasonId: "season-space-invaders",
      seasonSlug: "season-space-invaders",
      seasonName: "Season Space Invaders",
      weekId: "week-space-invaders",
      weekNumber: 1,
      webBaseUrl: "https://hsl.example",
      runtime: { type: "mame", minVersion: "0.286", recommendedVersion: "0.286" },
      mame: {
        romPath: "roms",
        launchArgs: [],
        profiles: {
          practice: { launchArgs: [] },
          competition: {
            launchArgs: [],
            integrity: { version: 1, mameVersion: "0.286", dips: [] },
          },
        },
      },
      capture: {
        mode: "plugin",
        pluginName: "hsl-score",
        adapter: "scripts/invaders.lua",
        automatic: { version: 1, strategy: "invaders-game-mode-final-v1" },
      },
    }, null, 2)}\n`);
    const loadedPack = loadPackFromDir(packRoot);
    assert.equal(loadedPack.loaded, true);
    assert.deepEqual(loadedPack.errors, []);
    await writeCompetitionManifest(loadedPack.pack);

    const deployment = { apiVersion: 1, build: "build-a", environment: "production" };
    const connection = { deployment: {}, reachability: "connecting", reachabilityGeneration: 0 };
    const weekCache = createWeekCapabilityCache({ userDataDir });
    await weekCache.initialize();
    await weekCache.remember({ authorityKey: "launcher-api:1", origin: "https://hsl.example" }, {
      checkedAt: "2026-07-31T00:00:00.000Z",
      conclusive: true,
      derivedStatus: "active",
      publicState: "active",
      rawStatus: "active",
      reason: "week-active",
      seasonId: "season-space-invaders",
      seasonStatus: "active",
      weekId: "week-space-invaders",
    });
    const weekService = createWeekCapabilitiesService({
      cache: weekCache,
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        return new Response(JSON.stringify({
          version: 1,
          build: "build-a",
          environment: "production",
          generatedAt: "2026-08-01T00:00:00.000Z",
          results: payload.requests.map((request) => ({
            requestKey: request.requestKey,
            weekId: request.weekId,
            seasonId: "season-space-invaders",
            seasonStatus: "active",
            derivedStatus: "active",
            publicState: "active",
            rawStatus: "active",
            reason: "week-active",
          })),
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-hsl-build": "build-a",
            "x-hsl-environment": "production",
            "x-hsl-launcher-api-version": "1",
          },
        });
      },
      getConnectivityState: () => connection,
      now: () => Date.parse("2026-08-01T00:00:00Z"),
      userDataDir,
    });
    await weekService.initialize();
    weekService.updateContext({ packs: [{ weekId: "week-space-invaders" }], webBaseUrl: "https://hsl.example" });
    const startupGeneration = weekService.getState().generation;
    assert.equal(weekService.getDiagnostics().context.authorityKey, "launcher-api:1");
    assert.equal(weekService.getCapability("week-space-invaders").publicState, "unknown");
    connection.deployment = { ...deployment };
    connection.reachability = "connected";
    connection.reachabilityGeneration = 8;
    weekService.updateDeployment();
    assert.equal(weekService.getState().generation, startupGeneration);
    assert.deepEqual(weekService.getDiagnostics().deployment.metadata, deployment);

    const config = {
      pack: loadedPack.pack,
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath: path.join(runtimeRoot, "mame.exe"),
        runtimeRoot,
        source: "external/dev",
        version: "0.286",
      },
      userDataDir,
    };
    const scope = {
      packKey: "pack_space-invaders",
      playerKey: "user_player-a",
      scopedQueueRoot: path.join(userDataDir, "players", "user_player-a", "packs", "pack_space-invaders"),
    };
    let spawnCount = 0;
    let prepareCount = 0;
    const phases = [];
    const launcherState = () => {
      const weekCapability = weekService.getCapability("week-space-invaders");
      const competitionReady = weekCapability.publicState === "active" && weekCapability.currentAuthority === true;
      return {
        competitionAccess: { canPlayCompetition: competitionReady },
        game: { weekId: "week-space-invaders" },
        membership: { effectiveStatus: "member", status: "member" },
        readiness: { canPlayCompetition: competitionReady, canPractice: true },
        selection: { activeInstanceKey: "space-invaders-dev-pack-v2" },
        session: { hasSession: true, userId: "player-a" },
        weekCapability,
      };
    };

    const result = await runCompetitionPlayPreflight({
      ensureFreshCapability: (weekId) => weekService.ensureFreshCapability(weekId),
      getAuthorityContext: () => ({
        authorityKey: "launcher-api:1",
        connected: true,
        origin: "https://hsl.example",
        reachabilityGeneration: 8,
      }),
      getState: async () => launcherState(),
      launch: async () => {
        prepareCount += 1;
        const prepared = await prepareV2CompetitionRun(config, scope, {
          detectMameVersionImpl: async () => "0.286",
          developerOverride: true,
          now: new Date("2026-08-01T00:00:00.000Z"),
          runId: "run_space_invaders",
          sourceDir,
        });
        assert.equal(prepared.runId, "run_space_invaders");
        const mame = await launchMameDetailed(prepared.config, "invaders", "competition", () => {
          spawnCount += 1;
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          queueMicrotask(() => {
            child.emit("spawn");
            child.emit("close", 0);
          });
          return child;
        }, {
          onSpawn: () => phases.push("mame-spawned"),
          onClose: () => phases.push("mame-closed"),
        });
        return { mameSpawned: true, ok: mame.exitCode === 0, phase: "mame-closed" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(weekService.getDiagnostics().lastRequest.httpStatus, 200);
    assert.equal(weekService.getDiagnostics().lastRequest.contractCompatible, true);
    assert.deepEqual(weekService.getDiagnostics().lastRequest.healthDeployment, deployment);
    assert.equal(weekService.getCapability("week-space-invaders").publicState, "active");
    assert.equal(prepareCount, 1);
    assert.equal(spawnCount, 1);
    assert.deepEqual(phases, ["mame-spawned", "mame-closed"]);
    weekService.stop();
  } finally {
    console.log = originalLog;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
