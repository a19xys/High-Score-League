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
