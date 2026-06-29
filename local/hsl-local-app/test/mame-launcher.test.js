const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  DEFAULT_PLUGIN_NAME,
  buildMameArgs,
  launchMame,
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
  assert.deepEqual(launch.args, ["invaders", "-plugins", "-plugin", "hsl-score"]);
});

test("practice builds MAME args without the score plugin", () => {
  const launch = buildMameArgs(mameConfig(), "invaders", "practice");

  assert.deepEqual(launch.args, ["invaders"]);
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

test("packVersion 2 practice builds MAME args with shared runtime resources", () => {
  const launch = buildMameArgs(packV2Config(), "invaders", "practice");

  assert.equal(launch.command, "C:/HSL/runtime/mame/mame.exe");
  assert.equal(launch.cwd, "C:/HSL/runtime/mame");
  assert.equal(launch.runtime, "shared-mame");
  assert.deepEqual(launch.args, [
    "invaders",
    "-rompath",
    "C:/Packs/space-invaders/roms",
    "-artpath",
    "C:/Packs/space-invaders/artwork",
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
      pluginSearchDir: "C:/HSL/userData/runtime/runs/run-1/plugins",
      stagingPendingDir: "C:/HSL/userData/runtime/runs/run-1/events/pending",
    },
  }), "invaders", "competition");

  assert.equal(launch.runtime, "shared-mame");
  assert.equal(launch.v2PluginRun.pluginName, "hsl-score");
  assert.deepEqual(launch.args, [
    "invaders",
    "-rompath",
    "C:/Packs/space-invaders/roms",
    "-artpath",
    "C:/Packs/space-invaders/artwork",
    "-samplepath",
    "C:/Packs/space-invaders/samples",
    "-cfg_directory",
    "C:/Packs/space-invaders/cfg",
    "-window",
    "-pluginspath",
    "C:/HSL/userData/runtime/runs/run-1/plugins",
    "-plugins",
    "-plugin",
    "hsl-score",
  ]);
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
      assert.deepEqual(args, ["invaders", "-plugins", "-plugin", "hsl-score"]);
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
  assert.match(output, /plugin\.ini/);
});
