const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getV2CaptureReadiness,
  prepareV2CompetitionRun,
} = require("../src/mame-plugin-run");
const { buildMameArgs } = require("../src/mame-launcher");
const { writeCompetitionManifest } = require("../src/competition-manifest");
const { loadPackFromDir } = require("../src/pack");

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
  await fsp.writeFile(path.join(sourceDir, "plugin.json"), JSON.stringify({ plugin: { version: "0.3.0" } }), "utf8");
  await fsp.writeFile(path.join(sourceDir, "core", "config.lua"), "return {}", "utf8");
  await fsp.writeFile(path.join(sourceDir, "games", "invaders.lua"), "return {}", "utf8");
  return sourceDir;
}

async function createV2Config(root, overrides = {}) {
  const packRoot = path.join(root, "pack");
  const adapterPath = path.join(packRoot, "scripts", "invaders.lua");
  const runtimeRoot = path.join(root, "runtime", "external-mame");
  await fsp.mkdir(path.dirname(adapterPath), { recursive: true });
  await fsp.writeFile(adapterPath, "return { read_memory = function() end, build_event = function() end }", "utf8");
  await fsp.mkdir(path.join(packRoot, "roms"), { recursive: true });
  await fsp.writeFile(path.join(packRoot, "roms", "invaders.zip"), "fixture-rom", "utf8");
  await fsp.writeFile(path.join(packRoot, "pack.json"), `${JSON.stringify({
    packVersion: 2,
    packId: "space-invaders-week-1",
    gameId: "space-invaders",
    rom: "invaders",
    weekId: "week-1",
    webBaseUrl: "https://high-score-league.vercel.app",
    runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
    mame: {
      romPath: "roms",
      launchArgs: [],
      profiles: {
        practice: { launchArgs: [] },
        competition: {
          launchArgs: [],
          integrity: {
            version: 1,
            mameVersion: "0.287",
            dips: [{ portTag: ":IN2", mask: 3, value: 0, label: "Lives", settingLabel: "3" }],
          },
        },
      },
    },
    capture: {
      mode: "plugin",
      pluginName: "hsl-score",
      adapter: "scripts/invaders.lua",
      automatic: { version: 1, strategy: "invaders-game-mode-final-v1" },
    },
  }, null, 2)}\n`, "utf8");
  await fsp.mkdir(path.join(runtimeRoot, "plugins"), { recursive: true });
  await fsp.writeFile(path.join(runtimeRoot, "plugins", "boot.lua"), "return { source = 'external/dev' }", "utf8");

  const config = {
    appDir: path.join(root, "app"),
    packRoot,
    userDataDir: path.join(root, "userData"),
    pack: {
      packVersion: 2,
      packId: "space-invaders-week-1",
      packRoot,
      contract: {
        version: 2,
        mame: {
          launchArgs: [],
          romDir: path.join(packRoot, "roms"),
          romPath: "roms",
          profiles: {
            practice: { cfgDir: null, cfgPath: null, integrity: null, launchArgs: [] },
            competition: {
              cfgDir: null,
              cfgPath: null,
              launchArgs: [],
              integrity: {
                version: 1,
                mameVersion: "0.287",
                dips: [{ portTag: ":IN2", mask: 3, value: 0, label: "Lives", settingLabel: "3" }],
              },
            },
          },
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
          adapter: "scripts/invaders.lua",
          adapterPath,
          automatic: { version: 1, strategy: "invaders-game-mode-final-v1" },
        },
      },
    },
    sharedMameRuntime: {
      available: true,
      configured: true,
      mameExecutablePath: path.join(runtimeRoot, "mame.exe"),
      runtimeRoot,
      source: "external/dev",
      version: "0.287",
    },
    ...overrides,
  };
  const loaded = loadPackFromDir(packRoot);
  assert.equal(loaded.loaded, true);
  assert.deepEqual(loaded.errors, []);
  config.pack = loaded.pack;
  await writeCompetitionManifest(config.pack);
  return config;
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
      developerOverride: true,
      runId: "run_test",
      sourceDir,
      detectMameVersionImpl: () => "0.287",
    });
    const configLua = await fsp.readFile(path.join(run.pluginDir, "config.lua"), "utf8");
    const manifest = JSON.parse(await fsp.readFile(path.join(run.runRoot, "run.json"), "utf8"));

    assert.equal(run.runId, "run_test");
    assert.equal(run.config.v2PluginRun.pluginSearchDir, path.join(run.runRoot, "plugins"));
    assert.equal(run.config.v2PluginRun.pluginBootstrapPath, path.join(run.runRoot, "plugins", "boot.lua"));
    assert.equal(await fsp.readFile(run.pluginBootstrapPath, "utf8"), "return { source = 'external/dev' }");
    assert.equal(await fsp.readFile(run.adapterPreparedPath, "utf8"), "return { read_memory = function() end, build_event = function() end }");
    assert.match(configLua, /gameModule = "games\/adapter\.lua"/);
    assert.match(configLua, /outputDir = /);
    assert.match(configLua, /events\\\\candidates|events\/candidates/);
    assert.equal(manifest.playerKey, scope.playerKey);
    assert.equal(manifest.packKey, scope.packKey);
    await fsp.access(run.stagingCandidatesDir);
    await fsp.access(path.join(run.pluginDir, "init.lua"));
    await fsp.access(path.join(run.pluginDir, "core", "config.lua"));
  });
});

test("dips empty prepares a protected run without inventing DIP fields", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const packPath = path.join(config.packRoot, "pack.json");
    const packJson = JSON.parse(await fsp.readFile(packPath, "utf8"));
    packJson.mame.profiles.competition.integrity.dips = [];
    await fsp.writeFile(packPath, `${JSON.stringify(packJson, null, 2)}\n`, "utf8");
    const loaded = loadPackFromDir(config.packRoot);
    assert.equal(loaded.loaded, true);
    assert.deepEqual(loaded.errors, []);
    config.pack = loaded.pack;
    await writeCompetitionManifest(config.pack);

    const run = await prepareV2CompetitionRun(config, {
      packKey: "pack_no-dips",
      playerKey: "user_no-dips",
      scopedQueueRoot: path.join(config.userDataDir, "queue-no-dips"),
    }, {
      developerOverride: true,
      detectMameVersionImpl: () => "0.287",
      runId: "run_no_dips",
      sourceDir,
    });
    assert.deepEqual(run.integrity.dips, []);
    const configLua = await fsp.readFile(path.join(run.pluginDir, "config.lua"), "utf8");
    assert.match(configLua, /dips = \{\s*\}/);
  });
});

for (const runtimeSource of ["bundled", "external/dev"]) {
  test(`prepareV2CompetitionRun copies only the selected ${runtimeSource} bootstrap beside hsl-score`, async () => {
    await withTempDir(async (dir) => {
      const sourceDir = await createPluginSource(dir);
      const runtimeRoot = path.join(dir, "runtime", runtimeSource.replace(/\W+/g, "-"));
      const bootstrap = `return { source = ${JSON.stringify(runtimeSource)} }`;
      await fsp.mkdir(path.join(runtimeRoot, "plugins", "data"), { recursive: true });
      await fsp.writeFile(path.join(runtimeRoot, "plugins", "boot.lua"), bootstrap, "utf8");
      await fsp.writeFile(path.join(runtimeRoot, "plugins", "data", "plugin.json"), JSON.stringify({
        plugin: { name: "data", type: "plugin", start: "true" },
      }), "utf8");
      await fsp.writeFile(path.join(runtimeRoot, "plugins", "data", "init.lua"), "return {}", "utf8");
      if (runtimeSource === "bundled") {
        await fsp.writeFile(path.join(runtimeRoot, "hsl-runtime-integrity.json"), "{}", "utf8");
        await fsp.writeFile(path.join(sourceDir, "hsl-plugin-integrity.json"), "{}", "utf8");
      }
      const config = await createV2Config(dir, {
        sharedMameRuntime: {
          available: true,
          configured: true,
          mameExecutablePath: path.join(runtimeRoot, "mame.exe"),
          runtimeRoot,
          source: runtimeSource,
        },
      });
      const run = await prepareV2CompetitionRun(config, {
        packKey: "pack_space-invaders-week-1",
        playerKey: "user_user-1",
        scopedQueueRoot: path.join(config.userDataDir, "queue"),
      }, {
        developerOverride: true,
        runId: `run_${runtimeSource.replace(/\W+/g, "_")}`,
        sourceDir,
        detectMameVersionImpl: () => "0.287",
        verifyBundledMameRuntimeIntegrityImpl: async () => ({ manifest: { files: [{
          path: "plugins/boot.lua",
          sha256: crypto.createHash("sha256").update(bootstrap).digest("hex"),
        }] } }),
        verifyBundledPluginIntegrityImpl: async () => ({}),
        verifyPreparedPluginIntegrityImpl: async () => ({}),
      });

      assert.equal(await fsp.readFile(run.pluginBootstrapPath, "utf8"), bootstrap);
      assert.equal(run.pluginBootstrapSourcePath, path.join(runtimeRoot, "plugins", "boot.lua"));
      assert.deepEqual((await fsp.readdir(run.pluginSearchDir)).sort(), ["boot.lua", "hsl-score"]);
      await assert.rejects(() => fsp.access(path.join(run.pluginSearchDir, "data", "plugin.json")));

      const launch = buildMameArgs(run.config, "invaders", "competition");
      const pluginSearchIndex = launch.args.indexOf("-pluginspath");
      assert.equal(launch.args[pluginSearchIndex + 1], run.pluginSearchDir);
      assert.equal(launch.args[pluginSearchIndex + 1].includes(path.join(runtimeRoot, "plugins")), false);
      assert.equal(launch.args[launch.args.indexOf("-inipath") + 1], run.iniDir);
      assert.equal(path.relative(runtimeRoot, launch.cwd).startsWith(".."), true);
    });
  });
}

test("prepareV2CompetitionRun fails before creating a run when the selected runtime has no boot.lua", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    await fsp.rm(path.join(config.sharedMameRuntime.runtimeRoot, "plugins", "boot.lua"));
    const expectedRunRoot = path.join(config.userDataDir, "runtime", "runs", "run_missing_boot");

    await assert.rejects(() => prepareV2CompetitionRun(config, {
      packKey: "pack_space-invaders-week-1",
      playerKey: "user_user-1",
      scopedQueueRoot: path.join(config.userDataDir, "queue"),
    }, { developerOverride: true, runId: "run_missing_boot", sourceDir, detectMameVersionImpl: () => "0.287" }), /falta plugins\/boot\.lua en el runtime MAME seleccionado/);
    await assert.rejects(() => fsp.access(expectedRunRoot));
  });
});

test("prepareV2CompetitionRun rejects an exact MAME mismatch before creating the run", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const expectedRunRoot = path.join(config.userDataDir, "runtime", "runs", "run_wrong_mame");

    await assert.rejects(() => prepareV2CompetitionRun(config, {
      packKey: "pack_space-invaders-week-1",
      playerKey: "user_user-1",
      scopedQueueRoot: path.join(config.userDataDir, "queue"),
    }, { developerOverride: true, runId: "run_wrong_mame", sourceDir, detectMameVersionImpl: () => "0.288" }), /requiere MAME 0\.287 exacto; se encontro 0\.288/);
    await assert.rejects(() => fsp.access(expectedRunRoot));
  });
});

test("competitive cfg seed is manifest-covered, copied per run and never reused as mutable state", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const seedDir = path.join(config.pack.packRoot, "cfg-competition", "nested");
    const seedPath = path.join(seedDir, "invaders.cfg");
    await fsp.mkdir(seedDir, { recursive: true });
    await fsp.writeFile(seedPath, "seed-v1\n", "utf8");
    config.pack.contract.mame.profiles.competition.cfgDir = path.dirname(seedDir);
    config.pack.contract.mame.profiles.competition.cfgPath = "cfg-competition";
    const packJsonPath = path.join(config.pack.packRoot, "pack.json");
    const packJson = JSON.parse(await fsp.readFile(packJsonPath, "utf8"));
    packJson.mame.profiles.competition.cfgPath = "cfg-competition";
    await fsp.writeFile(packJsonPath, `${JSON.stringify(packJson, null, 2)}\n`, "utf8");
    config.pack = loadPackFromDir(config.pack.packRoot).pack;
    await writeCompetitionManifest(config.pack);
    const scope = {
      packKey: "pack_space-invaders-week-1",
      playerKey: "user_user-1",
      scopedQueueRoot: path.join(config.userDataDir, "queue"),
    };

    const first = await prepareV2CompetitionRun(config, scope, {
      developerOverride: true, runId: "run_seed_1", sourceDir, detectMameVersionImpl: () => "0.287",
    });
    assert.equal(await fsp.readFile(path.join(first.cfgDir, "nested", "invaders.cfg"), "utf8"), "seed-v1\n");
    await fsp.writeFile(path.join(first.cfgDir, "nested", "invaders.cfg"), "mutated-run\n", "utf8");
    assert.equal(await fsp.readFile(seedPath, "utf8"), "seed-v1\n");

    const second = await prepareV2CompetitionRun(config, scope, {
      developerOverride: true, runId: "run_seed_2", sourceDir, detectMameVersionImpl: () => "0.287",
    });
    assert.equal(await fsp.readFile(path.join(second.cfgDir, "nested", "invaders.cfg"), "utf8"), "seed-v1\n");
    for (const name of ["cfg", "ctrlr", "nvram", "inp", "sta", "snap", "diff", "comments", "share", "home", "ini", "plugins", "events"]) {
      await fsp.access(path.join(second.runRoot, name));
    }
  });
});
