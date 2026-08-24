"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildMameArgs } = require("../../src/mame-launcher");
const { ensureMameStateDirectories } = require("../../src/mame-runtime-state");
const { loadPackFromDir } = require("../../src/pack");

function countArg(args, option) {
  return args.filter((value) => value === option).length;
}

async function main() {
  const packRoot = path.resolve(process.argv[2] || "D:/High Score League/Space Invaders");
  const mameExecutablePath = path.resolve(process.argv[3] || "C:/MAME/mame.exe");
  const qaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-space-practice-"));
  try {
    const loaded = loadPackFromDir(packRoot);
    assert.equal(loaded.loaded, true);
    assert.deepEqual(loaded.errors, []);
    const pack = structuredClone(loaded.pack);
    const practiceCfg = path.join(qaRoot, "practice-cfg");
    pack.contract.mame.cfgDir = practiceCfg;
    pack.contract.mame.profiles.practice.cfgDir = practiceCfg;
    const config = {
      pack,
      packRoot,
      userDataDir: path.join(qaRoot, "userData"),
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath,
        runtimeRoot: path.dirname(mameExecutablePath),
        source: "external/dev",
        version: "0.287",
      },
    };
    const launch = buildMameArgs(config, pack.rom, "practice");
    ensureMameStateDirectories(launch.mutableDirectories);
    assert.equal(countArg(launch.args, "-video"), 1);
    assert.equal(launch.args[launch.args.indexOf("-video") + 1], "bgfx");
    assert.equal(countArg(launch.args, "-bgfx_screen_chains"), 1);
    assert.equal(launch.args[launch.args.indexOf("-bgfx_screen_chains") + 1], "crt-geom");
    assert.ok(launch.args.includes("-noplugins"));
    assert.equal(launch.args.includes("-ctrlr"), false);
    assert.equal(launch.args.includes("-plugin"), false);

    const diagnosticArgs = [
      ...launch.args,
      "-autoboot_delay", "0",
      "-autoboot_script", path.resolve(__dirname, "..", "..", "test", "support", "mame-0287-diagnostic.lua"),
    ];
    assert.equal(countArg(diagnosticArgs, "-video"), 1);
    assert.equal(countArg(diagnosticArgs, "-bgfx_screen_chains"), 1);
    const diagnostic = spawnSync(launch.command, diagnosticArgs, {
      cwd: launch.cwd, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    const diagnosticOutput = `${diagnostic.stdout || ""}${diagnostic.stderr || ""}`;
    assert.equal(diagnostic.status, 0, diagnosticOutput);
    assert.match(diagnosticOutput, /CONTROLS argv_authority/);
    assert.doesNotMatch(diagnosticOutput, /Plugin v0\.4\.0 cargado|Integridad competitiva ARMADA/);

    const practiceMarker = path.join(qaRoot, "practice-reset.marker");
    const operationsArgs = [
      ...launch.args,
      "-autoboot_delay", "0",
      "-autoboot_script", path.resolve(__dirname, "..", "..", "test", "support", "mame-0287-practice-qa.lua"),
    ];
    assert.equal(countArg(operationsArgs, "-video"), 1);
    assert.equal(countArg(operationsArgs, "-bgfx_screen_chains"), 1);
    const operations = spawnSync(launch.command, operationsArgs, {
      cwd: launch.cwd,
      encoding: "utf8",
      env: { ...process.env, HSL_PRACTICE_QA_MARKER: practiceMarker },
      timeout: 45_000,
      windowsHide: true,
    });
    const operationsOutput = `${operations.stdout || ""}${operations.stderr || ""}`;
    assert.equal(operations.status, 0, operationsOutput);
    for (const expected of [
      "DIP_CHANGED value=1", "NOTIFIER pause", "NOTIFIER resume",
      "NOTIFIER state_save", "NOTIFIER state_load", "ACTION hard_reset", "RESET_REBUILT",
    ]) {
      assert.match(operationsOutput, new RegExp(expected));
    }
    assert.doesNotMatch(operationsOutput, /Integridad competitiva|Candidate escrito/);
    assert.deepEqual(await fsp.readdir(path.join(packRoot, "cfg")), []);

    process.stdout.write(`${JSON.stringify({
      sameVisualFilter: "crt-geom",
      tabSequence: "KEYCODE_TAB",
      pause: true,
      saveLoad: true,
      dipsFree: true,
      reset: true,
      competitionController: false,
      integrityMonitor: false,
      runInputWatcher: false,
      automaticCandidate: false,
      provenanceRequired: false,
      packCfgStillEmpty: true,
    }, null, 2)}\n`);
  } finally {
    await fsp.rm(qaRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
