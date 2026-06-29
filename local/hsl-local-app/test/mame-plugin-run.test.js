const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getV2CaptureReadiness,
  prepareV2CompetitionRun,
} = require("../src/mame-plugin-run");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-plugin-run-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function createPluginSource(root) {
  const sourceDir = path.join(root, "app-plugin", "hsl-score");
  await fsp.mkdir(path.join(sourceDir, "core"), { recursive: true });
  await fsp.mkdir(path.join(sourceDir, "games"), { recursive: true });
  await fsp.writeFile(path.join(sourceDir, "init.lua"), "return {}", "utf8");
  await fsp.writeFile(path.join(sourceDir, "plugin.json"), "{}", "utf8");
  await fsp.writeFile(path.join(sourceDir, "core", "config.lua"), "return {}", "utf8");
  await fsp.writeFile(path.join(sourceDir, "games", "invaders.lua"), "return {}", "utf8");
  return sourceDir;
}

async function createV2Config(root, overrides = {}) {
  const packRoot = path.join(root, "pack");
  const adapterPath = path.join(packRoot, "scripts", "invaders.lua");
  await fsp.mkdir(path.dirname(adapterPath), { recursive: true });
  await fsp.writeFile(adapterPath, "return { read_memory = function() end, build_event = function() end }", "utf8");

  return {
    appDir: path.join(root, "app"),
    packRoot,
    userDataDir: path.join(root, "userData"),
    pack: {
      packVersion: 2,
      packId: "space-invaders-week-1",
      packRoot,
      contract: {
        version: 2,
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
          adapter: "scripts/invaders.lua",
          adapterPath,
        },
      },
    },
    ...overrides,
  };
}

test("getV2CaptureReadiness rejects unsafe adapter paths", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    config.pack.contract.capture.adapter = "../outside.lua";
    config.pack.contract.capture.adapterPath = path.join(dir, "outside.lua");

    const readiness = getV2CaptureReadiness(config, { sourceDir });

    assert.equal(readiness.ok, false);
    assert.ok(readiness.errors.some((item) => /ruta relativa segura/.test(item)));
    assert.ok(readiness.errors.some((item) => /fuera de la carpeta/.test(item)));
  });
});

test("prepareV2CompetitionRun copies plugin, adapter and run config", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const scope = {
      packKey: "pack_space-invaders-week-1",
      playerKey: "user_user-1",
      scopedQueueRoot: path.join(config.userDataDir, "players", "user_user-1", "packs", "pack_space-invaders-week-1"),
    };

    const run = await prepareV2CompetitionRun(config, scope, {
      now: new Date("2026-06-30T00:00:00.000Z"),
      runId: "run_test",
      sourceDir,
    });
    const configLua = await fsp.readFile(path.join(run.pluginDir, "config.lua"), "utf8");
    const manifest = JSON.parse(await fsp.readFile(path.join(run.runRoot, "run.json"), "utf8"));

    assert.equal(run.runId, "run_test");
    assert.equal(run.config.v2PluginRun.pluginSearchDir, path.join(run.runRoot, "plugins"));
    assert.equal(await fsp.readFile(run.adapterPreparedPath, "utf8"), "return { read_memory = function() end, build_event = function() end }");
    assert.match(configLua, /gameModule = "games\/adapter\.lua"/);
    assert.match(configLua, /outputDir = /);
    assert.match(configLua, /events\\\\pending|events\/pending/);
    assert.equal(manifest.playerKey, scope.playerKey);
    assert.equal(manifest.packKey, scope.packKey);
    await fsp.access(run.stagingPendingDir);
    await fsp.access(path.join(run.pluginDir, "init.lua"));
    await fsp.access(path.join(run.pluginDir, "core", "config.lua"));
  });
});
