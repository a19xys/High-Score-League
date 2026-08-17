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
    userDataDir: "C:/HSL/userData",
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

function argumentValue(args, option) {
  const index = args.indexOf(option);
  return index < 0 ? null : args[index + 1];
}

test("packVersion 2 practice builds MAME args with shared runtime resources", () => {
  const launch = buildMameArgs(packV2Config(), "invaders", "practice");

  assert.equal(launch.command, "C:/HSL/runtime/mame/mame.exe");
  assert.equal(launch.cwd, path.join("C:/HSL/userData", "runtime", "mame", "state", "home"));
  assert.equal(launch.runtime, "external/dev");
  assert.equal(argumentValue(launch.args, "-rompath"), "C:/Packs/space-invaders/roms");
  assert.equal(argumentValue(launch.args, "-artpath"), packArtworkPath());
  assert.equal(argumentValue(launch.args, "-samplepath"), `C:/Packs/space-invaders/samples${path.delimiter}${path.join("C:/HSL/runtime/mame", "samples")}`);
  assert.equal(argumentValue(launch.args, "-cfg_directory"), "C:/Packs/space-invaders/cfg");
  assert.equal(argumentValue(launch.args, "-nvram_directory"), path.join("C:/HSL/userData", "runtime", "mame", "state", "nvram"));
  assert.equal(argumentValue(launch.args, "-bgfx_path"), sharedMameBgfxPath());
  assert.equal(launch.args.includes("-noplugins"), true);
  assert.equal(launch.args.includes("-plugin"), false);
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

  assert.equal(launch.runtime, "external/dev");
  assert.equal(launch.v2PluginRun.pluginName, "hsl-score");
  assert.equal(argumentValue(launch.args, "-inipath"), path.join("C:/HSL/userData/runtime/runs/run-1", "ini"));
  assert.equal(argumentValue(launch.args, "-homepath"), "C:/HSL/userData/runtime/runs/run-1");
  assert.equal(argumentValue(launch.args, "-pluginspath"), buildPluginSearchPath("C:/HSL/userData/runtime/runs/run-1/plugins", "C:/HSL/runtime/mame"));
  assert.equal(argumentValue(launch.args, "-plugin"), "hsl-score");
  assert.equal(launch.args.includes("-plugins"), true);
  assert.equal(launch.args.includes("-noplugins"), false);
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

  assert.equal(argumentValue(launch.args, "-cfg_directory"), "C:/Packs/space-invaders/cfg-competition");
  assert.equal(argumentValue(launch.args, "-video"), "bgfx");
  assert.equal(argumentValue(launch.args, "-bgfx_screen_chains"), "crt-geom");
  assert.equal(argumentValue(launch.args, "-bgfx_path"), sharedMameBgfxPath());
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

test("packVersion 2 rejects pack-controlled bgfx_path", () => {
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
  assert.throws(() => buildMameArgs(config, "invaders", "competition"), /opcion reservada -bgfx_path/);
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
  assert.equal(launch.args.includes("-bgfx_path"), true);
  assert.equal(launch.args.includes("-noplugins"), true);
});

test("packVersion 2 competition pluginpath keeps isolated plugin before MAME base plugins", () => {
  const pluginSearchPath = buildPluginSearchPath("C:/HSL/userData/runtime/runs/run-1/plugins", "C:/HSL/runtime/mame");

  assert.equal(pluginSearchPath, `C:/HSL/userData/runtime/runs/run-1/plugins${path.delimiter}${path.join("C:/HSL/runtime/mame", "plugins")}`);
});

test("packVersion 2 keeps every mutable output outside the installed runtime", () => {
  const launch = buildMameArgs(packV2Config(), "invaders", "practice");
  const runtimeRoot = path.resolve("C:/HSL/runtime/mame");
  for (const option of [
    "-inipath", "-homepath", "-cfg_directory", "-nvram_directory", "-input_directory",
    "-state_directory", "-snapshot_directory", "-diff_directory", "-comment_directory", "-share_directory",
  ]) {
    const value = argumentValue(launch.args, option);
    const relative = path.relative(runtimeRoot, path.resolve(value));
    assert.equal(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)), false, `${option}=${value}`);
  }
  assert.equal(launch.cwd.startsWith(runtimeRoot), false);
});

test("competition inipath cannot inherit plugin.ini from the runtime", () => {
  const runRoot = "C:/HSL/userData/runtime/runs/run-isolated";
  const launch = buildMameArgs(packV2Config({
    v2PluginRun: {
      pluginName: "hsl-score",
      runId: "run-isolated",
      runRoot,
      pluginSearchDir: path.join(runRoot, "plugins"),
      stagingPendingDir: path.join(runRoot, "events", "pending"),
    },
  }), "invaders", "competition");
  assert.equal(argumentValue(launch.args, "-inipath"), path.join(runRoot, "ini"));
  assert.notEqual(argumentValue(launch.args, "-inipath"), "C:/HSL/runtime/mame");
  assert.equal(launch.args.includes("-plugins"), true);
  assert.equal(argumentValue(launch.args, "-plugin"), "hsl-score");
});

test("pack minimum MAME version blocks an older runtime", () => {
  const base = packV2Config();
  const config = packV2Config({
    pack: {
      ...base.pack,
      contract: {
        ...base.pack.contract,
        runtime: { minVersion: "0.288", recommendedVersion: "0.288", type: "mame" },
      },
    },
    sharedMameRuntime: {
      ...base.sharedMameRuntime,
      version: "0.287",
    },
  });
  assert.throws(() => buildMameArgs(config, "invaders", "practice"), /no cumple runtime\.minVersion 0\.288/);
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
  assert.match(output, /Plugins: desactivados explicitamente para practica/);
  assert.match(output, /Args: invaders -skip_gameinfo -plugins -plugin hsl-score/);
  assert.doesNotMatch(output, /podria cargarlo igualmente/);
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
