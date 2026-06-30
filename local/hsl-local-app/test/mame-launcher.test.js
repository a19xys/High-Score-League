const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_PLUGIN_NAME,
  buildMameArgs,
  buildPluginSearchPath,
  launchMame,
  launchMameDetailed,
  printLaunchSummary,
} = require("../src/mame-launcher");

function mameConfig(overrides = {}) {
  return {
    mame: {
      executablePath: "C:/MAME/mame.exe",
      workingDir: "C:/MAME",
      pluginName: "hsl-score",
      ...overrides,
    },
  };
}

test("play builds MAME args for invaders with the configured plugin", () => {
  const launch = buildMameArgs(mameConfig(), "invaders", "competition");

  assert.equal(launch.command, "C:/MAME/mame.exe");
  assert.equal(launch.cwd, "C:/MAME");
  assert.equal(launch.rom, "invaders");
  assert.equal(launch.game.gameId, "space-invaders");
  assert.deepEqual(launch.args, ["invaders", "-skip_gameinfo", "-plugins", "-plugin", "hsl-score"]);
});

test("practice builds MAME args without the score plugin", () => {
  const launch = buildMameArgs(mameConfig(), "invaders", "practice");

  assert.deepEqual(launch.args, ["invaders", "-skip_gameinfo"]);
});

test("unknown ROMs are rejected before launching MAME", () => {
  assert.throws(
    () => buildMameArgs(mameConfig(), "unknown-rom", "competition"),
    /ROM no soportada: unknown-rom/
  );
});

test("incomplete MAME config is rejected before launching MAME", () => {
  assert.throws(() => buildMameArgs({}, "invaders", "competition"), /mame\.executablePath/);
  assert.throws(
    () => buildMameArgs(mameConfig({ executablePath: "" }), "invaders", "competition"),
    /mame\.executablePath/
  );
  assert.throws(
    () => buildMameArgs(mameConfig({ workingDir: "" }), "invaders", "competition"),
    /mame\.workingDir/
  );
});

function packV2Config(overrides = {}) {
  return {
    pack: {
      packVersion: 2,
      rom: "invaders",
      contract: {
        version: 2,
        mame: {
          romDir: "C:/Packs/space-invaders/roms",
          artworkDir: "C:/Packs/space-invaders/artwork",
          sampleDir: "C:/Packs/space-invaders/samples",
          cfgDir: "C:/Packs/space-invaders/cfg",
          launchArgs: ["-window"],
        },
        capture: {
          pluginName: "hsl-score",
        },
      },
    },
    sharedMameRuntime: {
      available: true,
      configured: true,
      mameExecutablePath: "C:/HSL/runtime/mame/mame.exe",
    },
    ...overrides,
  };
}

function sharedMameArtworkPath() {
  return path.join("C:/HSL/runtime/mame", "artwork");
}

function sharedMameBgfxPath() {
  return path.join("C:/HSL/runtime/mame", "bgfx");
}

function packArtworkPath() {
  return `C:/Packs/space-invaders/artwork${path.delimiter}${sharedMameArtworkPath()}`;
}

test("packVersion 2 practice builds MAME args with shared runtime resources", () => {
  const launch = buildMameArgs(packV2Config(), "invaders", "practice");

  assert.equal(launch.command, "C:/HSL/runtime/mame/mame.exe");
  assert.equal(launch.cwd, "C:/HSL/runtime/mame");
  assert.equal(launch.runtime, "shared-mame");
  assert.deepEqual(launch.args, [
    "invaders",
    "-skip_gameinfo",
    "-rompath",
    "C:/Packs/space-invaders/roms",
    "-artpath",
    packArtworkPath(),
    "-samplepath",
    "C:/Packs/space-invaders/samples",
    "-cfg_directory",
    "C:/Packs/space-invaders/cfg",
    "-window",
  ]);
});

test("packVersion 2 competition is blocked until capture adapter loading exists", () => {
  assert.throws(
    () => buildMameArgs(packV2Config(), "invaders", "competition"),
    /requiere preparar plugin\/adaptador aislado/
  );
});

test("packVersion 2 competition uses prepared pluginpath and score plugin", () => {
  const launch = buildMameArgs(packV2Config({
    v2PluginRun: {
      pluginName: "hsl-score",
      runId: "run-1",
      runRoot: "C:/HSL/userData/runtime/runs/run-1",
      pluginSearchDir: "C:/HSL/userData/runtime/runs/run-1/plugins",
      stagingPendingDir: "C:/HSL/userData/runtime/runs/run-1/events/pending",
    },
  }), "invaders", "competition");

  assert.equal(launch.runtime, "shared-mame");
  assert.equal(launch.v2PluginRun.pluginName, "hsl-score");
  assert.deepEqual(launch.args, [
    "invaders",
    "-skip_gameinfo",
    "-rompath",
    "C:/Packs/space-invaders/roms",
    "-artpath",
    packArtworkPath(),
    "-samplepath",
    "C:/Packs/space-invaders/samples",
    "-cfg_directory",
    "C:/Packs/space-invaders/cfg",
    "-window",
    "-homepath",
    "C:/HSL/userData/runtime/runs/run-1",
    "-pluginspath",
    buildPluginSearchPath("C:/HSL/userData/runtime/runs/run-1/plugins", "C:/HSL/runtime/mame"),
    "-plugins",
    "-plugin",
    "hsl-score",
  ]);
});

test("packVersion 2 launch applies mode-specific MAME profile", () => {
  const config = packV2Config({
    pack: {
      ...packV2Config().pack,
      contract: {
        ...packV2Config().pack.contract,
        mame: {
          ...packV2Config().pack.contract.mame,
          profiles: {
            competition: {
              cfgDir: "C:/Packs/space-invaders/cfg-competition",
              launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
            },
          },
        },
      },
    },
    v2PluginRun: {
      pluginName: "hsl-score",
      runId: "run-1",
      runRoot: "C:/HSL/userData/runtime/runs/run-1",
      pluginSearchDir: "C:/HSL/userData/runtime/runs/run-1/plugins",
      stagingPendingDir: "C:/HSL/userData/runtime/runs/run-1/events/pending",
    },
  });
  const launch = buildMameArgs(config, "invaders", "competition");

  assert.deepEqual(launch.args.slice(0, 17), [
    "invaders",
    "-skip_gameinfo",
    "-rompath",
    "C:/Packs/space-invaders/roms",
    "-artpath",
    packArtworkPath(),
    "-samplepath",
    "C:/Packs/space-invaders/samples",
    "-cfg_directory",
    "C:/Packs/space-invaders/cfg-competition",
    "-window",
    "-video",
    "bgfx",
    "-bgfx_screen_chains",
    "crt-geom",
    "-bgfx_path",
    sharedMameBgfxPath(),
  ]);
});

test("packVersion 2 BGFX keeps pack artwork before MAME artwork and adds bgfx_path once", () => {
  const config = packV2Config({
    pack: {
      ...packV2Config().pack,
      contract: {
        ...packV2Config().pack.contract,
        mame: {
          ...packV2Config().pack.contract.mame,
          profiles: {
            competition: {
              launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
            },
          },
        },
      },
    },
    v2PluginRun: {
      pluginName: "hsl-score",
      runId: "run-1",
      runRoot: "C:/HSL/userData/runtime/runs/run-1",
      pluginSearchDir: "C:/HSL/userData/runtime/runs/run-1/plugins",
      stagingPendingDir: "C:/HSL/userData/runtime/runs/run-1/events/pending",
    },
  });
  const launch = buildMameArgs(config, "invaders", "competition");

  assert.equal(launch.args[launch.args.indexOf("-artpath") + 1], packArtworkPath());
  assert.equal(launch.args[launch.args.indexOf("-bgfx_path") + 1], sharedMameBgfxPath());
  assert.equal(launch.args.filter((item) => item === "-bgfx_path").length, 1);
});

test("packVersion 2 BGFX respects explicit bgfx_path", () => {
  const explicitBgfxPath = "D:/Custom/bgfx";
  const config = packV2Config({
    pack: {
      ...packV2Config().pack,
      contract: {
        ...packV2Config().pack.contract,
        mame: {
          ...packV2Config().pack.contract.mame,
          profiles: {
            competition: {
              launchArgs: ["-video", "bgfx", "-bgfx_path", explicitBgfxPath],
            },
          },
        },
      },
    },
    v2PluginRun: {
      pluginName: "hsl-score",
      runId: "run-1",
      runRoot: "C:/HSL/userData/runtime/runs/run-1",
      pluginSearchDir: "C:/HSL/userData/runtime/runs/run-1/plugins",
      stagingPendingDir: "C:/HSL/userData/runtime/runs/run-1/events/pending",
    },
  });
  const launch = buildMameArgs(config, "invaders", "competition");

  assert.equal(launch.args.filter((item) => item === "-bgfx_path").length, 1);
  assert.equal(launch.args[launch.args.indexOf("-bgfx_path") + 1], explicitBgfxPath);
});

test("packVersion 2 practice ignores competition-only video profile", () => {
  const config = packV2Config({
    pack: {
      ...packV2Config().pack,
      contract: {
        ...packV2Config().pack.contract,
        mame: {
          ...packV2Config().pack.contract.mame,
          profiles: {
            practice: {
              launchArgs: [],
            },
            competition: {
              cfgDir: "C:/Packs/space-invaders/cfg",
              launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
            },
          },
        },
      },
    },
  });
  const launch = buildMameArgs(config, "invaders", "practice");

  assert.equal(launch.mode, "practice");
  assert.equal(launch.args.includes("-plugins"), false);
  assert.equal(launch.args.includes("-plugin"), false);
  assert.equal(launch.args.includes("-video"), false);
  assert.equal(launch.args.includes("crt-geom"), false);
  assert.equal(launch.args.includes("-bgfx_path"), false);
});

test("packVersion 2 competition pluginpath keeps isolated plugin before MAME base plugins", () => {
  const pluginSearchPath = buildPluginSearchPath("C:/HSL/userData/runtime/runs/run-1/plugins", "C:/HSL/runtime/mame");

  assert.equal(pluginSearchPath, `C:/HSL/userData/runtime/runs/run-1/plugins${path.delimiter}${path.join("C:/HSL/runtime/mame", "plugins")}`);
});

test("packVersion 2 practice requires shared runtime", () => {
  assert.throws(
    () => buildMameArgs(packV2Config({ sharedMameRuntime: { configured: false, available: false } }), "invaders", "practice"),
    /Runtime MAME compartido no configurado/
  );
});

test("packVersion 2 launch requires an existing romDir before spawn", async () => {
  assert.throws(
    () => launchMame(packV2Config(), "invaders", "practice", () => {
      throw new Error("spawn should not run");
    }),
    /directorio de ROMs/
  );
});

test("play defaults to the hsl-score plugin when pluginName is omitted", () => {
  const launch = buildMameArgs(mameConfig({ pluginName: undefined }), "invaders", "competition");

  assert.equal(launch.args.at(-1), DEFAULT_PLUGIN_NAME);
});

test("launchMame uses spawn with inherited stdio and returns the exit code", async () => {
  const originalLog = console.log;
  console.log = () => {};

  let exitCode;

  try {
    exitCode = await launchMame(mameConfig(), "invaders", "competition", (command, args, options) => {
      assert.equal(command, "C:/MAME/mame.exe");
      assert.deepEqual(args, ["invaders", "-skip_gameinfo", "-plugins", "-plugin", "hsl-score"]);
      assert.deepEqual(options, {
        cwd: "C:/MAME",
        stdio: "inherit",
      });

      const child = new EventEmitter();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(exitCode, 0);
});

test("launchMameDetailed captures stdout and stderr tails", async () => {
  const originalLog = console.log;
  console.log = () => {};

  let result;

  try {
    result = await launchMameDetailed(mameConfig(), "invaders", "competition", (command, args, options) => {
      assert.equal(command, "C:/MAME/mame.exe");
      assert.deepEqual(args, ["invaders", "-skip_gameinfo", "-plugins", "-plugin", "hsl-score"]);
      assert.deepEqual(options, {
        cwd: "C:/MAME",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit("data", "[HSL] Plugin cargado\n");
        child.stderr.emit("data", "Lua warning\n");
        child.emit("close", 0);
      });
      return child;
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutLines, ["[HSL] Plugin cargado"]);
  assert.deepEqual(result.stderrLines, ["Lua warning"]);
});

test("printLaunchSummary explains competition and practice plugin behavior", () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line = "") => lines.push(String(line));

  try {
    printLaunchSummary(buildMameArgs(mameConfig(), "invaders", "competition"));
    printLaunchSummary(buildMameArgs(mameConfig(), "invaders", "practice"));
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /Modo: competicion/);
  assert.match(output, /Plugin: hsl-score activado explicitamente/);
  assert.match(output, /Modo: practica/);
  assert.match(output, /Plugin: hsl-score no se activa explicitamente/);
  assert.match(output, /Args: invaders -skip_gameinfo -plugins -plugin hsl-score/);
  assert.match(output, /plugin\.ini/);
});

test("printLaunchSummary shows final competition profile args", () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line = "") => lines.push(String(line));

  try {
    const config = packV2Config({
      pack: {
        ...packV2Config().pack,
        contract: {
          ...packV2Config().pack.contract,
          mame: {
            ...packV2Config().pack.contract.mame,
            profiles: {
              competition: {
                launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
              },
            },
          },
        },
      },
      v2PluginRun: {
        pluginName: "hsl-score",
        runId: "run-1",
        runRoot: "C:/HSL/userData/runtime/runs/run-1",
        pluginSearchDir: "C:/HSL/userData/runtime/runs/run-1/plugins",
        stagingPendingDir: "C:/HSL/userData/runtime/runs/run-1/events/pending",
      },
    });

    printLaunchSummary(buildMameArgs(config, "invaders", "competition"));
  } finally {
    console.log = originalLog;
  }

  assert.match(lines.join("\n"), /Args: .* -video bgfx -bgfx_screen_chains crt-geom /);
});

test("packVersion 2 launch requires the concrete ROM zip before spawn", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-mame-launcher-test-"));

  try {
    const romDir = path.join(dir, "roms");
    await fsp.mkdir(romDir, { recursive: true });
    const config = packV2Config({
      pack: {
        ...packV2Config().pack,
        contract: {
          ...packV2Config().pack.contract,
          mame: {
            ...packV2Config().pack.contract.mame,
            romDir,
            romPath: "roms",
          },
        },
      },
    });

    assert.throws(
      () => launchMame(config, "invaders", "practice", () => {
        throw new Error("spawn should not run");
      }),
      /Falta la ROM necesaria: roms\/invaders\.zip/
    );
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
