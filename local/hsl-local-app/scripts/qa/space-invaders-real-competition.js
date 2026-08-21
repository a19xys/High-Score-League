"use strict";

// Explicit real-MAME QA; intentionally outside the default node --test scan.

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyCompetitionManifest } = require("../../src/competition-manifest");
const { buildMameArgs } = require("../../src/mame-launcher");
const { prepareV2CompetitionRun } = require("../../src/mame-plugin-run");
const { loadPackFromDir } = require("../../src/pack");

function argumentValue(args, option) {
  const index = args.lastIndexOf(option);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const packRoot = path.resolve(process.argv[2] || "D:/High Score League/Space Invaders");
  const mameExecutablePath = path.resolve(process.argv[3] || "C:/MAME/mame.exe");
  const runtimeRoot = path.dirname(mameExecutablePath);
  const qaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-space-invaders-real-qa-"));
  try {
    const loaded = loadPackFromDir(packRoot);
    assert.equal(loaded.loaded, true);
    assert.deepEqual(loaded.errors, []);
    const manifest = await verifyCompetitionManifest(loaded.pack);
    const config = {
      appDir: path.resolve(__dirname, "..", ".."),
      pack: loaded.pack,
      packRoot,
      userDataDir: path.join(qaRoot, "userData"),
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath,
        runtimeRoot,
        source: "external/dev",
        version: "0.287",
      },
    };
    const run = await prepareV2CompetitionRun(config, {
      packKey: "pack_real_qa",
      playerKey: "player_real_qa",
      scopedQueueRoot: path.join(qaRoot, "queue"),
    }, { runId: "run_real_qa" });
    const launch = buildMameArgs(run.config, loaded.pack.rom, "competition");
    const mutable = ["cfg", "nvram", "input", "state", "snapshot", "diff", "comment", "share", "home", "ini"];
    for (const name of mutable) {
      const directory = argumentValue(launch.args, `-${name}_directory`) || argumentValue(launch.args, `-${name}path`);
      assert.ok(directory, name);
      assert.equal(path.relative(run.runRoot, directory).startsWith(".."), false, name);
    }
    assert.equal(argumentValue(launch.args, "-ctrlr"), "hsl-competition");
    assert.equal(argumentValue(launch.args, "-plugin"), "hsl-score");
    assert.equal(argumentValue(launch.args, "-cfg_directory"), run.cfgDir);
    assert.notEqual(argumentValue(launch.args, "-cfg_directory"), loaded.pack.contract.mame.cfgDir);

    const diagnosticScript = path.resolve(__dirname, "..", "..", "test", "support", "mame-0287-diagnostic.lua");
    const processResult = spawnSync(launch.command, [
      ...launch.args,
      "-video", "none",
      "-sound", "none",
      "-seconds_to_run", "2",
      "-autoboot_delay", "0",
      "-autoboot_script", diagnosticScript,
    ], { cwd: launch.cwd, encoding: "utf8", timeout: 30000, windowsHide: true });
    const output = `${processResult.stdout || ""}${processResult.stderr || ""}`;
    assert.equal(processResult.status, 0, output);
    assert.match(output, /Plugin v0\.2\.0 cargado/);
    assert.match(output, /Integridad competitiva ARMADA/);
    assert.match(output, /TYPE token=UI_MENU .*empty=true/);
    assert.match(output, /TYPE token=UI_CANCEL .*seq=KEYCODE_ESC empty=false/);
    assert.match(output, /DIP tag=:IN2 mask=3 name=Lives value=0 .*setting=3/);
    assert.match(output, /DIP tag=:IN2 mask=8 name=Bonus Life value=0 .*setting=1500/);
    assert.match(output, /RUNTIME paused=false speed_factor=1000 throttled=true throttle_rate=(?:1|1[,.]0) menu_active=false/);
    assert.match(output, /Integridad competitiva final: CLEAN/);

    process.stdout.write(`${JSON.stringify({
      manifestSha256: manifest.manifestSha256,
      mameVersion: run.integrity.observedMameVersion,
      pluginVersion: "0.2.0",
      controller: "hsl-competition",
      cfgIsPerRun: true,
      clean: true,
    }, null, 2)}\n`);
  } finally {
    await fsp.rm(qaRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
