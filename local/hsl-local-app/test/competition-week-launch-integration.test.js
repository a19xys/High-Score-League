const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runCompetitionPlayPreflight } = require("../src/competition-play-preflight");
const { createWeekCapabilitiesService } = require("../src/week-capabilities-service");
const { launchMameDetailed } = require("../src/mame-launcher");
const { prepareV2CompetitionRun } = require("../src/mame-plugin-run");

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
      writeFile(path.join(sourceDir, "plugin.json"), "{}"),
      writeFile(path.join(sourceDir, "core", "config.lua"), "return {}"),
      writeFile(path.join(sourceDir, "games", "invaders.lua"), "return {}"),
    ]);

    const deployment = { apiVersion: 1, build: "build-a", environment: "production" };
    const connection = { deployment, reachability: "connected", reachabilityGeneration: 8 };
    const weekService = createWeekCapabilitiesService({
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

    const config = {
      pack: {
        packVersion: 2,
        packId: "space-invaders-dev-pack-v2",
        gameId: "space-invaders",
        packRoot,
        rom: "invaders",
        weekId: "week-space-invaders",
        contract: {
          version: 2,
          capture: {
            mode: "plugin",
            pluginName: "hsl-score",
            adapter: "scripts/invaders.lua",
            adapterPath,
          },
          mame: { romDir, launchArgs: [] },
        },
      },
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath: path.join(runtimeRoot, "mame.exe"),
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
    const launcherState = () => ({
      competitionAccess: { canPlayCompetition: true },
      game: { weekId: "week-space-invaders" },
      membership: { effectiveStatus: "member", status: "member" },
      readiness: { canPlayCompetition: true, canPractice: true },
      selection: { activeInstanceKey: "space-invaders-dev-pack-v2" },
      session: { hasSession: true, userId: "player-a" },
      weekCapability: weekService.getCapability("week-space-invaders").publicState === "unknown"
        ? { publicState: "active", weekId: "week-space-invaders" }
        : weekService.getCapability("week-space-invaders"),
    });

    const result = await runCompetitionPlayPreflight({
      ensureFreshCapability: (weekId) => weekService.ensureFreshCapability(weekId),
      getAuthorityContext: () => ({
        connected: true,
        deploymentKey: "build-a:production:1",
        origin: "https://hsl.example",
        reachabilityGeneration: 8,
      }),
      getState: async () => launcherState(),
      launch: async () => {
        prepareCount += 1;
        const prepared = await prepareV2CompetitionRun(config, scope, {
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
