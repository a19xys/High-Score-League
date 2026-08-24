"use strict";

// Explicit real-MAME QA; intentionally outside the default node --test scan.

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { verifyCompetitionManifest } = require("../../src/competition-manifest");
const { finalizeCompetitionRun } = require("../../src/competition-run-finalizer");
const { launchMameDetailed } = require("../../src/mame-launcher");
const { prepareV2CompetitionRun } = require("../../src/mame-plugin-run");
const { loadPackFromDir } = require("../../src/pack");
const { establishProtectedScopeAuthority } = require("../../src/competition-scope-authority");

function argumentValue(args, option) {
  const index = args.lastIndexOf(option);
  return index >= 0 ? args[index + 1] : null;
}

function countArg(args, option) {
  return args.filter((value) => value === option).length;
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
    const scope = {
      packKey: "pack_real_qa",
      playerKey: "player_real_qa",
      userId: "00000000-0000-4000-8000-000000000287",
      scopedQueueRoot: path.join(qaRoot, "queue"),
      scopedPendingDir: path.join(qaRoot, "queue", "events", "pending"),
      scopedRejectedDir: path.join(qaRoot, "queue", "events", "rejected"),
    };
    await Promise.all([
      fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
      fsp.mkdir(scope.scopedRejectedDir, { recursive: true }),
    ]);
    await establishProtectedScopeAuthority(scope, {
      playerKey: scope.playerKey,
      packKey: scope.packKey,
      packId: loaded.pack.packId,
      weekId: loaded.pack.weekId,
    });
    const diagnosticScript = path.resolve(__dirname, "..", "..", "test", "support", "mame-0287-diagnostic.lua");
    const run = await prepareV2CompetitionRun(config, scope, {
      developerOverride: true,
      developerQa: { autobootScriptPath: diagnosticScript },
      runId: "run_real_qa",
    });
    const launch = run.launchPlan;
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

    assert.equal(countArg(launch.args, "-video"), 1);
    assert.equal(countArg(launch.args, "-bgfx_screen_chains"), 1);
    let finalized = null;
    let liveOutput = "";
    const spawnObserved = (command, args, options) => {
      const child = spawn(command, args, options);
      child.stdout.on("data", (chunk) => { liveOutput += String(chunk); });
      child.stderr.on("data", (chunk) => { liveOutput += String(chunk); });
      return child;
    };
    const processResult = await launchMameDetailed(run.config, loaded.pack.rom, "competition", spawnObserved, {
      async onClose(exitCode) {
        finalized = await finalizeCompetitionRun(run, scope, { compact: false, exitCode });
      },
    });
    const output = `${liveOutput}\n${processResult.stdoutLines.join("\n")}\n${processResult.stderrLines.join("\n")}`;
    assert.equal(processResult.exitCode, 0, output);
    assert.match(output, /Plugin v0\.4\.0 cargado/);
    assert.match(output, /Integridad competitiva ARMADA/);
    assert.match(output, /CONTROLS argv_authority/);
    assert.match(output, /DIP tag=:IN2 mask=3 name=Lives value=0 .*setting=3/);
    assert.match(output, /DIP tag=:IN2 mask=8 name=Bonus Life value=0 .*setting=1500/);
    assert.match(output, /RUNTIME paused=false speed_factor=1000 throttled=true throttle_rate=(?:1|1[,.]0) menu_active=false/);
    assert.match(output, /Integridad competitiva final: CLEAN/);
    assert.equal(finalized.status, "developer_qa");
    assert.deepEqual(await fsp.readdir(scope.scopedPendingDir), []);

    process.stdout.write(`${JSON.stringify({
      manifestSha256: manifest.manifestSha256,
      mameVersion: run.integrity.observedMameVersion,
      pluginVersion: "0.4.0",
      controller: "hsl-competition",
      controlsVerifiedBy: "sealed argv + controller fixture",
      cfgIsPerRun: true,
      clean: true,
      finalStatus: finalized.status,
      productionPending: 0,
      actualArgvEqualsSealedPlan: true,
    }, null, 2)}\n`);
  } finally {
    await fsp.rm(qaRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
