const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getV2CaptureReadiness,
  getV2CompetitionReadiness,
  prepareV2CompetitionRun,
} = require("../src/mame-plugin-run");
const { buildMameArgs } = require("../src/mame-launcher");
const { launchMame } = require("../src/mame-launcher");
const { writeCompetitionManifest } = require("../src/competition-manifest");
const { loadPackFromDir } = require("../src/pack");
const {
  createRunInputMonitor,
  materializeCompetitionCfgSeed,
  physicalWatchPath,
  readRunInputState,
  verifyCompetitionCfgMaterialization,
  verifyRunInputs,
  verifyRunInputsAfterClose,
} = require("../src/run-input-integrity");
const { EventEmitter } = require("node:events");

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
  await fsp.writeFile(path.join(sourceDir, "plugin.json"), JSON.stringify({ plugin: { version: "0.4.0" } }), "utf8");
  await fsp.writeFile(path.join(sourceDir, "core", "config.lua"), "return {}", "utf8");
  await fsp.writeFile(path.join(sourceDir, "games", "invaders.lua"), "return {}", "utf8");
  return sourceDir;
}

async function createV2Config(root, overrides = {}) {
  const packRoot = path.join(root, "pack");
  const adapterPath = path.join(packRoot, "scripts", "invaders.lua");
  const runtimeRoot = path.join(root, "runtime", "external-mame");
  await fsp.mkdir(path.dirname(adapterPath), { recursive: true });
  await fsp.writeFile(adapterPath, "return { observe_capture = function() end }", "utf8");
  await fsp.mkdir(path.join(packRoot, "roms"), { recursive: true });
  await fsp.writeFile(path.join(packRoot, "roms", "invaders.zip"), "fixture-rom", "utf8");
  await fsp.mkdir(path.join(packRoot, "artwork"), { recursive: true });
  await fsp.writeFile(path.join(packRoot, "artwork", "invaders.zip"), "fixture-artwork", "utf8");
  await fsp.writeFile(path.join(packRoot, "pack.json"), `${JSON.stringify({
    packVersion: 2,
    packId: "space-invaders-week-1",
    gameId: "space-invaders",
    rom: "invaders",
    weekId: "week-1",
    webBaseUrl: "https://highscoreleague.com",
    runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
    mame: {
      romPath: "roms",
      artworkPath: "artwork",
      launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
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
  await fsp.writeFile(path.join(runtimeRoot, "mame.exe"), "fixture-mame", "utf8");

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
          launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
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

test("protected visual options are common-only for every normalized alias", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const aliases = [
      ["--video=bgfx"], ["/video", "bgfx"], ["-video:bgfx"],
      ["--bgfx_screen_chains=crt-geom"], ["-bgfx-screen-chains", "crt-geom"],
      ["/bgfx_screen_chains:crt-geom"],
    ];
    for (const args of aliases) {
      for (const mode of ["practice", "competition"]) {
        config.pack.contract.mame.profiles[mode].launchArgs = args;
        const readiness = getV2CompetitionReadiness(config, { developerOverride: true, sourceDir });
        assert.equal(readiness.ok, false, `${mode}: ${args.join(" ")}`);
        assert.ok(readiness.errors.some((item) => /ajustes visuales compartidos/.test(item)));
        config.pack.contract.mame.profiles[mode].launchArgs = [];
      }
    }
  });
});

test("protected common visual aliases become one canonical pair in both effective modes", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    config.pack.contract.mame.launchArgs = ["--video=bgfx", "/bgfx-screen-chains:crt-geom"];
    const readiness = getV2CompetitionReadiness(config, { developerOverride: true, sourceDir });
    assert.equal(readiness.ok, true, readiness.errors.join(" "));
    const run = await prepareV2CompetitionRun(config, {
      packKey: "pack_visual", playerKey: "user_visual", scopedQueueRoot: path.join(config.userDataDir, "queue"),
    }, { developerOverride: true, userId: "visual", runId: "run_visual_alias", sourceDir, detectMameVersionImpl: () => "0.287" });
    const practice = buildMameArgs(run.config, "invaders", "practice").args;
    const competition = buildMameArgs(run.config, "invaders", "competition").args;
    for (const args of [practice, competition]) {
      assert.equal(args.filter((token) => token === "-video").length, 1);
      assert.equal(args[args.indexOf("-video") + 1], "bgfx");
      assert.equal(args.filter((token) => token === "-bgfx_screen_chains").length, 1);
      assert.equal(args[args.indexOf("-bgfx_screen_chains") + 1], "crt-geom");
    }
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
      userId: "user-1",
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
    assert.equal(await fsp.readFile(run.adapterPreparedPath, "utf8"), "return { observe_capture = function() end }");
    assert.match(configLua, /gameModule = "games\/adapter\.lua"/);
    assert.match(configLua, /outputDir = /);
    assert.match(configLua, /commitmentsDir = /);
    assert.match(configLua, /candidateLedgerPath = /);
    assert.match(configLua, /events\\\\candidates|events\/candidates/);
    assert.equal(manifest.playerKey, scope.playerKey);
    assert.equal(manifest.packKey, scope.packKey);
    await fsp.access(run.stagingCandidatesDir);
    await fsp.access(path.join(run.pluginDir, "init.lua"));
    await fsp.access(path.join(run.pluginDir, "core", "config.lua"));
  });
});

test("real developer QA harness is copied, sealed and used by the single launch plan", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const qaScript = path.join(dir, "qa.lua");
    await fsp.writeFile(qaScript, "emu.register_frame_done(function() manager.machine:exit() end, 'qa')\n", "utf8");
    const scope = {
      packKey: "pack_space-invaders-week-1",
      playerKey: "user_user-qa",
      scopedQueueRoot: path.join(config.userDataDir, "players", "user_user-qa", "packs", "pack_space-invaders-week-1"),
    };
    const run = await prepareV2CompetitionRun(config, scope, {
      developerOverride: true,
      developerQa: { autobootScriptPath: qaScript, violation: "pause" },
      detectMameVersionImpl: () => "0.287",
      runId: "run_qa_harness",
      sourceDir,
      userId: "user-qa",
    });
    const manifest = JSON.parse(await fsp.readFile(run.runInputManifestPath, "utf8"));
    const launch = buildMameArgs(run.config, config.pack.rom, "competition");

    assert.deepEqual(launch.args, run.launchPlan.args);
    assert.equal(launch.args.at(-2), "-autoboot_script");
    assert.equal(launch.args.at(-1), run.developerQa.preparedPath);
    assert.equal(run.launchPlan.environmentOverrides.HSL_AUTO_QA_VIOLATION, "pause");
    assert.ok(manifest.files.some((entry) => entry.role === "developer_qa_harness"
      && entry.path === "integrity/developer-qa-autoboot.lua"));
    await verifyRunInputs(run);
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
      userId: "no-dips",
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
      await fsp.writeFile(path.join(runtimeRoot, "mame.exe"), "fixture-mame", "utf8");
      await fsp.writeFile(path.join(runtimeRoot, "plugins", "data", "plugin.json"), JSON.stringify({
        plugin: { name: "data", type: "plugin", start: "true" },
      }), "utf8");
      await fsp.writeFile(path.join(runtimeRoot, "plugins", "data", "init.lua"), "return {}", "utf8");
      if (runtimeSource === "bundled") {
        await fsp.writeFile(path.join(runtimeRoot, "hsl-runtime-integrity.json"), "{}", "utf8");
        await fsp.writeFile(path.join(sourceDir, "hsl-plugin-integrity.json"), "{}", "utf8");
        await fsp.writeFile(path.join(dir, "product-integrity-root.json"), "{}", "utf8");
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
        userId: "user-1",
        runId: `run_${runtimeSource.replace(/\W+/g, "_")}`,
        sourceDir,
        detectMameVersionImpl: () => "0.287",
        productRootPath: path.join(dir, "product-integrity-root.json"),
        verifyProductIntegrityRootImpl: async () => ({
          sha256: "f".repeat(64),
          root: {
            mameVersion: "0.287",
            pluginVersion: "0.4.0",
            runtimeManifestSha256: "a".repeat(64),
            pluginManifestSha256: "b".repeat(64),
          },
          runtime: { manifest: { files: [{
            path: "plugins/boot.lua",
            sha256: crypto.createHash("sha256").update(bootstrap).digest("hex"),
          }] } },
        }),
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
    }, { developerOverride: true, userId: "user-1", runId: "run_missing_boot", sourceDir, detectMameVersionImpl: () => "0.287" }), /falta plugins\/boot\.lua en el runtime MAME seleccionado/);
    await fsp.access(path.join(expectedRunRoot, "preparing.marker"));
    await assert.rejects(() => fsp.access(path.join(expectedRunRoot, "prepared.marker")));
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
    }, { developerOverride: true, userId: "user-1", runId: "run_wrong_mame", sourceDir, detectMameVersionImpl: () => "0.288" }), /requiere MAME 0\.287 exacto; se encontro 0\.288/);
    await fsp.access(path.join(expectedRunRoot, "preparing.marker"));
    await assert.rejects(() => fsp.access(path.join(expectedRunRoot, "prepared.marker")));
  });
});

test("competitive cfg seed is sealed separately and materialized exactly before spawn", async () => {
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
      developerOverride: true, userId: "user-1", runId: "run_seed_1", sourceDir, detectMameVersionImpl: () => "0.287",
    });
    assert.equal(await fsp.readFile(path.join(first.cfgSeedDir, "nested", "invaders.cfg"), "utf8"), "seed-v1\n");
    assert.deepEqual(await fsp.readdir(first.cfgDir), []);
    await materializeCompetitionCfgSeed(first);
    assert.equal(await fsp.readFile(path.join(first.cfgDir, "nested", "invaders.cfg"), "utf8"), "seed-v1\n");
    assert.equal(await verifyCompetitionCfgMaterialization(first), true);
    await fsp.writeFile(path.join(first.cfgDir, "nested", "invaders.cfg"), "mutated-run\n", "utf8");
    assert.equal(await fsp.readFile(seedPath, "utf8"), "seed-v1\n");
    assert.ok(await verifyRunInputsAfterClose(first));

    const second = await prepareV2CompetitionRun(config, scope, {
      developerOverride: true, userId: "user-1", runId: "run_seed_2", sourceDir, detectMameVersionImpl: () => "0.287",
    });
    assert.equal(await fsp.readFile(path.join(second.cfgSeedDir, "nested", "invaders.cfg"), "utf8"), "seed-v1\n");
    assert.deepEqual(await fsp.readdir(second.cfgDir), []);
    const manifest = JSON.parse(await fsp.readFile(second.runInputManifestPath, "utf8"));
    assert.ok(manifest.files.some((entry) => entry.role === "cfg_seed" && entry.path === "seeds/cfg/nested/invaders.cfg"));
    for (const name of ["cfg", "seeds", "ctrlr", "nvram", "inp", "sta", "snap", "diff", "comments", "share", "home", "ini", "plugins", "events"]) {
      await fsp.access(path.join(second.runRoot, name));
    }
  });
});

test("cfg seed tampering blocks spawn while runtime cfg changes remain mutable", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const seedDir = path.join(config.pack.packRoot, "cfg-competition");
    await fsp.mkdir(seedDir, { recursive: true });
    await fsp.writeFile(path.join(seedDir, "invaders.cfg"), "seed-v1\n", "utf8");
    const packJsonPath = path.join(config.pack.packRoot, "pack.json");
    const packJson = JSON.parse(await fsp.readFile(packJsonPath, "utf8"));
    packJson.mame.profiles.competition.cfgPath = "cfg-competition";
    await fsp.writeFile(packJsonPath, `${JSON.stringify(packJson, null, 2)}\n`, "utf8");
    config.pack = loadPackFromDir(config.pack.packRoot).pack;
    await writeCompetitionManifest(config.pack);
    const prepare = (runId) => prepareV2CompetitionRun(config, {
      packKey: "pack_cfg", playerKey: "user_cfg", scopedQueueRoot: path.join(config.userDataDir, "queue"),
    }, { developerOverride: true, userId: "cfg-user", runId, sourceDir, detectMameVersionImpl: () => "0.287" });

    const before = await prepare("run_cfg_before");
    await fsp.writeFile(path.join(before.cfgSeedDir, "invaders.cfg"), "tampered\n", "utf8");
    let spawns = 0;
    await assert.rejects(() => launchMame(before.config, "invaders", "competition", () => {
      spawns += 1;
      return new EventEmitter();
    }), /Input sellado modificado/);
    assert.equal(spawns, 0);

    const during = await prepare("run_cfg_during");
    const verified = await verifyRunInputs(during);
    const callbacks = new Map();
    const monitor = await createRunInputMonitor(during, verified, {
      watchImpl(filePath, _options, callback) {
        const watcher = new EventEmitter();
        watcher.close = () => {};
        callbacks.set(path.resolve(filePath), callback);
        return watcher;
      },
    });
    await materializeCompetitionCfgSeed(during);
    await fsp.writeFile(path.join(during.cfgDir, "invaders.cfg"), "legitimate-runtime-change\n", "utf8");
    assert.equal(callbacks.has(path.resolve(path.join(during.cfgDir, "invaders.cfg"))), false);
    await fsp.writeFile(path.join(during.cfgSeedDir, "invaders.cfg"), "tampered-during\n", "utf8");
    callbacks.get(path.resolve(path.join(during.cfgSeedDir, "invaders.cfg")))("change", null);
    assert.equal(await verifyRunInputsAfterClose(during, { monitor }), null);
    assert.deepEqual((await monitor.close()).violations, ["run_input_changed"]);
  });
});

test("run-input manifest blocks every protected input class before spawn", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const targets = [
      ["ROM snapshot", (run) => path.join(run.snapshotRoot, "roms", "invaders.zip")],
      ["artwork snapshot", (run) => path.join(run.snapshotRoot, "artwork", "invaders.zip")],
      ["adapter preparado", (run) => run.adapterPreparedPath],
      ["config generado", (run) => path.join(run.pluginDir, "config.lua")],
      ["controller", (run) => run.controllerPath],
      ["plugin core", (run) => path.join(run.pluginDir, "core", "config.lua")],
      ["boot.lua", (run) => run.pluginBootstrapPath],
    ];
    for (let index = 0; index < targets.length; index += 1) {
      const [label, resolveTarget] = targets[index];
      const run = await prepareV2CompetitionRun(config, {
        packKey: "pack_attack",
        playerKey: "user_attack",
        scopedQueueRoot: path.join(config.userDataDir, "players", "user_attack", "packs", "pack_attack"),
      }, {
        developerOverride: true,
        userId: "attack-user",
        runId: `run_input_attack_${index}`,
        sourceDir,
        detectMameVersionImpl: () => "0.287",
      });
      await fsp.appendFile(resolveTarget(run), "tamper");
      let spawns = 0;
      await assert.rejects(() => launchMame(run.config, "invaders", "competition", () => {
        spawns += 1;
        return new EventEmitter();
      }), /Input sellado modificado/);
      assert.equal(spawns, 0, label);
    }
  });
});

test("post-run verification and observed restore attacks cover every protected input class", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const targets = [
      ["ROM snapshot", (run) => path.join(run.snapshotRoot, "roms", "invaders.zip")],
      ["artwork snapshot", (run) => path.join(run.snapshotRoot, "artwork", "invaders.zip")],
      ["adapter preparado", (run) => run.adapterPreparedPath],
      ["config generado", (run) => path.join(run.pluginDir, "config.lua")],
      ["controller", (run) => run.controllerPath],
      ["plugin core", (run) => path.join(run.pluginDir, "core", "config.lua")],
      ["boot.lua", (run) => run.pluginBootstrapPath],
    ];
    const prepare = (runId) => prepareV2CompetitionRun(config, {
      packKey: "pack_watch",
      playerKey: "user_watch",
      scopedQueueRoot: path.join(config.userDataDir, "players", "user_watch", "packs", "pack_watch"),
    }, { developerOverride: true, userId: "watch-user", runId, sourceDir, detectMameVersionImpl: () => "0.287" });

    for (let index = 0; index < targets.length; index += 1) {
      const [label, resolveTarget] = targets[index];
      const persistent = await prepare(`run_persistent_${index}`);
      await fsp.appendFile(resolveTarget(persistent), "persistent-tamper");
      assert.equal(await verifyRunInputsAfterClose(persistent), null, label);
      assert.deepEqual((await readRunInputState(persistent)).violations, ["run_input_changed"], label);

      const restored = await prepare(`run_restored_${index}`);
      const verified = await verifyRunInputs(restored);
      const callbacks = new Map();
      const monitor = await createRunInputMonitor(restored, verified, {
        watchImpl(filePath, _options, callback) {
          const watcher = new EventEmitter();
          watcher.close = () => {};
          callbacks.set(path.resolve(filePath), callback);
          return watcher;
        },
      });
      const targetPath = path.resolve(resolveTarget(restored));
      const original = await fsp.readFile(targetPath);
      await fsp.appendFile(targetPath, "temporary-tamper");
      assert.equal(typeof callbacks.get(targetPath), "function", label);
      callbacks.get(targetPath)("change", null);
      await fsp.writeFile(targetPath, original);
      assert.ok(await verifyRunInputsAfterClose(restored), label);
      await monitor.close();
      assert.deepEqual((await readRunInputState(restored)).violations, ["run_input_changed"], label);
    }
  });
});

test("run input violation survives restored bytes and deleted persisted state", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    const run = await prepareV2CompetitionRun(config, {
      packKey: "pack_sticky", playerKey: "user_sticky", scopedQueueRoot: path.join(config.userDataDir, "queue"),
    }, { developerOverride: true, userId: "sticky", runId: "run_sticky_delete", sourceDir, detectMameVersionImpl: () => "0.287" });
    const verified = await verifyRunInputs(run);
    const callbacks = new Map();
    const monitor = await createRunInputMonitor(run, verified, {
      watchImpl(filePath, _options, callback) {
        const watcher = new EventEmitter();
        watcher.close = () => {};
        callbacks.set(path.resolve(filePath), callback);
        return watcher;
      },
    });
    const targetPath = path.resolve(run.adapterPreparedPath);
    const original = await fsp.readFile(targetPath);
    await fsp.appendFile(targetPath, "temporary-tamper");
    callbacks.get(targetPath)("change", null);
    await fsp.writeFile(targetPath, original);
    await fsp.rm(path.join(run.integrityDir, "app", "run-input-state.json"));
    assert.ok(await verifyRunInputsAfterClose(run, { monitor }));
    assert.ok((await monitor.close()).violations.includes("run_input_changed"));
    assert.ok((await readRunInputState(run, { required: true })).violations.includes("run_input_changed"));
  });
});

test("missing or corrupt dynamic state after monitor armed becomes integrity_unavailable", async (t) => {
  await withTempDir(async (dir) => {
    const sourceDir = await createPluginSource(dir);
    const config = await createV2Config(dir);
    for (const state of ["missing", "empty", "corrupt", "wrong-run"]) {
      const run = await prepareV2CompetitionRun(config, {
        packKey: "pack_state", playerKey: "user_state", scopedQueueRoot: path.join(config.userDataDir, "queue"),
      }, { developerOverride: true, userId: "state", runId: `run_state_${state}`, sourceDir, detectMameVersionImpl: () => "0.287" });
      const monitor = await createRunInputMonitor(run, await verifyRunInputs(run), {
        watchImpl() {
          const watcher = new EventEmitter();
          watcher.close = () => {};
          return watcher;
        },
      });
      const statePath = path.join(run.integrityDir, "app", "run-input-state.json");
      if (state === "missing") await fsp.rm(statePath);
      if (state === "empty") await fsp.writeFile(statePath, "", "utf8");
      if (state === "corrupt") await fsp.writeFile(statePath, "{bad", "utf8");
      if (state === "wrong-run") await fsp.writeFile(statePath, JSON.stringify({
        version: 1, runId: "other-run", violations: [], updatedAt: "2026-08-21T10:00:00.000Z",
      }), "utf8");
      assert.deepEqual((await monitor.close()).violations, ["integrity_unavailable"], state);
      assert.deepEqual((await readRunInputState(run, { required: true })).violations, ["integrity_unavailable"], state);
    }
  });
});

test("ASAR virtual entries verify normally but monitor only receives the physical container", () => {
  const root = path.join("C:\\Program Files", "High Score League", "resources", "app.asar");
  assert.equal(physicalWatchPath(path.join(root, "product", "product-integrity-root.json")), path.resolve(root));
  assert.equal(physicalWatchPath(path.join(root, "product", "hsl-runtime-integrity.json")), path.resolve(root));
  const regular = path.join("C:\\fixture", "runtime", "mame.exe");
  assert.equal(physicalWatchPath(regular), path.resolve(regular));
});
