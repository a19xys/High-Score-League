"use strict";

// Explicit real-MAME QA. This script is not shipped or scanned by node --test.

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { verifyCompetitionManifest } = require("../../src/competition-manifest");
const { finalizeCompetitionRun } = require("../../src/competition-run-finalizer");
const { checkProtectedCompetitionEligibility } = require("../../src/competition-submission-eligibility");
const { launchMameDetailed } = require("../../src/mame-launcher");
const { prepareV2CompetitionRun } = require("../../src/mame-plugin-run");
const { writePackProvenanceReceipt } = require("../../src/pack-provenance");
const { loadPackFromDir } = require("../../src/pack");
const { configureProductRuntime, resetProductRuntime } = require("../../src/product-runtime");
const packageMetadata = require("../../package.json");

async function listJson(directory) {
  return (await fsp.readdir(directory).catch(() => []))
    .filter((name) => name.toLowerCase().endsWith(".json"));
}

function countArg(args, option) {
  return args.filter((value) => value === option).length;
}

async function main() {
  const appDir = path.resolve(__dirname, "..", "..");
  const packRoot = path.resolve(process.argv[2] || "D:/High Score League/Space Invaders");
  const mameExecutablePath = path.resolve(process.argv[3]
    || path.join(appDir, ".cache", "product", "mame", "0.287", "runtime", "mame.exe"));
  const mode = process.argv[4] || "clean";
  assert.ok(["clean", "pause", "dip_changed", "save_load", "reset", "crash"].includes(mode), `QA mode invalido: ${mode}`);
  const qaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-space-auto-final-"));
  configureProductRuntime({ appPath: path.join(appDir, ".cache"), isPackaged: false, version: packageMetadata.version });
  try {
    const loaded = loadPackFromDir(packRoot);
    assert.equal(loaded.loaded, true);
    assert.deepEqual(loaded.errors, []);
    const verifiedManifest = await verifyCompetitionManifest(loaded.pack);
    const userDataDir = path.join(qaRoot, "userData");
    const config = {
      appDir,
      pack: loaded.pack,
      packRoot,
      userDataDir,
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath,
        runtimeRoot: path.dirname(mameExecutablePath),
        source: "bundled",
        version: "0.287",
      },
    };
    await writePackProvenanceReceipt(config, {
      artifactSha256: "a".repeat(64),
      artifactSizeBytes: 1,
      competitionManifestSha256: verifiedManifest.manifestSha256,
      packId: loaded.pack.packId,
    });
    const scope = {
      packKey: "pack_real_auto_qa",
      playerKey: "player_real_auto_qa",
      userId: "00000000-0000-4000-8000-000000000287",
      scopedQueueRoot: path.join(qaRoot, "queue"),
      scopedPendingDir: path.join(qaRoot, "queue", "events", "pending"),
      scopedRejectedDir: path.join(qaRoot, "queue", "events", "rejected"),
    };
    await Promise.all([
      fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
      fsp.mkdir(scope.scopedRejectedDir, { recursive: true }),
    ]);
    const run = await prepareV2CompetitionRun(config, scope, {
      developerQa: {
        autobootScriptPath: path.resolve(appDir, "test", "support", "mame-0287-invaders-auto-capture-qa.lua"),
        remoteVerifiedFixture: true,
        violation: mode === "crash" ? "clean" : mode,
      },
      productRootPath: path.join(appDir, ".cache", "product", "product-integrity-root.json"),
      runId: `run_real_automatic_qa_${mode}`,
      sourceDir: path.join(appDir, ".cache", "product", "hsl", "mame-plugin", "hsl-score"),
    });

    let liveOutput = "";
    let candidateObservedBeforeClose = false;
    let pendingWhileOpen = null;
    let finalized = null;
    let actualArgs = null;
    const spawnObserved = (command, args, options) => {
      actualArgs = [...args];
      assert.deepEqual(actualArgs, run.launchPlan.args);
      assert.equal(command, run.launchPlan.command);
      assert.equal(options.cwd, run.launchPlan.cwd);
      assert.equal(countArg(actualArgs, "-video"), 1);
      assert.equal(actualArgs[actualArgs.indexOf("-video") + 1], "bgfx");
      assert.equal(countArg(actualArgs, "-bgfx_screen_chains"), 1);
      assert.equal(actualArgs[actualArgs.indexOf("-bgfx_screen_chains") + 1], "crt-geom");
      const child = spawn(command, args, options);
      const timeout = setTimeout(() => child.kill(), 240_000);
      child.once("close", () => clearTimeout(timeout));
      const collect = (chunk) => {
        liveOutput += String(chunk);
        if (!candidateObservedBeforeClose && liveOutput.includes("Candidate comprometido")) {
          candidateObservedBeforeClose = true;
          void (async () => {
            pendingWhileOpen = (await listJson(scope.scopedPendingDir)).length;
            assert.equal((await listJson(run.stagingCandidatesDir)).length > 0, true);
            if (mode === "crash") child.kill();
          })();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      return child;
    };
    const result = await launchMameDetailed(run.config, loaded.pack.rom, "competition", spawnObserved, {
      async onClose(exitCode) {
        finalized = await finalizeCompetitionRun(run, scope, { compact: false, exitCode });
      },
    });
    const output = `${liveOutput}\n${result.stdoutLines.join("\n")}\n${result.stderrLines.join("\n")}`;
    if (mode === "crash") assert.notEqual(result.exitCode, 0, output);
    else assert.equal(result.exitCode, 0, output);
    assert.equal(candidateObservedBeforeClose, true, output);
    assert.equal(pendingWhileOpen, 0);
    assert.match(output, /AUTOMATIC_FINAL/);
    assert.ok(finalized);

    const expectedStatus = mode === "clean" ? "clean" : mode === "crash" ? "fail_closed" : "violated";
    assert.equal(finalized.status, expectedStatus, JSON.stringify(finalized, null, 2));
    assert.equal(finalized.adopted.length, mode === "clean" ? 1 : 0);
    assert.deepEqual(await listJson(scope.scopedPendingDir), mode === "clean" ? [finalized.adopted[0].filename] : []);
    let eligibility = null;
    let score = null;
    if (mode === "clean") {
      const eventPath = finalized.adopted[0].finalPath;
      const event = JSON.parse(await fsp.readFile(eventPath, "utf8"));
      score = event.score;
      assert.equal(event.score > 0, true);
      assert.equal(event.detection.manualConfirm, false);
      eligibility = await checkProtectedCompetitionEligibility({
        competitionPlayerBinding: run.playerBinding,
        defaultWeekId: loaded.pack.weekId,
        pack: loaded.pack,
        scopedQueue: { scopedQueueRoot: scope.scopedQueueRoot },
        userDataDir,
      }, event, eventPath);
      assert.equal(eligibility.eligible, true, JSON.stringify(eligibility));
    }

    process.stdout.write(`${JSON.stringify({
      actualArgvEqualsSealedPlan: JSON.stringify(actualArgs) === JSON.stringify(run.launchPlan.args),
      candidateObservedBeforeClose,
      mode,
      pendingWhileOpen,
      finalStatus: finalized.status,
      promotedAfterClose: finalized.adopted.length,
      rejected: finalized.rejected.length,
      violations: finalized.violations,
      score,
      eventEligible: eligibility?.eligible ?? false,
      strategy: run.automaticCaptureStrategy,
      manifestSha256: run.integrity.manifestSha256,
      provenance: run.provenance.mode,
      visualArgs: { video: "bgfx", chain: "crt-geom", countEach: 1 },
    }, null, 2)}\n`);
  } finally {
    resetProductRuntime();
    await fsp.rm(qaRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
