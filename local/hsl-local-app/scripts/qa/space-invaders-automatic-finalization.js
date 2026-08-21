"use strict";

// Explicit real-MAME QA. This script is not shipped or scanned by node --test.

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { finalizeCompetitionRun } = require("../../src/competition-run-finalizer");
const { buildMameArgs } = require("../../src/mame-launcher");
const { prepareV2CompetitionRun } = require("../../src/mame-plugin-run");
const { loadPackFromDir } = require("../../src/pack");

async function listJson(directory) {
  return (await fsp.readdir(directory).catch(() => []))
    .filter((name) => name.toLowerCase().endsWith(".json"));
}

async function main() {
  const packRoot = path.resolve(process.argv[2] || "D:/High Score League/Space Invaders");
  const mameExecutablePath = path.resolve(process.argv[3] || "C:/MAME/mame.exe");
  const mode = process.argv[4] || "clean";
  assert.ok(["clean", "pause", "dip_changed", "save_load", "reset", "crash"].includes(mode), `QA mode invalido: ${mode}`);
  const qaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-space-auto-final-"));
  try {
    const loaded = loadPackFromDir(packRoot);
    assert.equal(loaded.loaded, true);
    assert.deepEqual(loaded.errors, []);
    const config = {
      appDir: path.resolve(__dirname, "..", ".."),
      pack: loaded.pack,
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
    const scope = {
      packKey: "pack_real_auto_qa",
      playerKey: "player_real_auto_qa",
      scopedQueueRoot: path.join(qaRoot, "queue"),
      scopedPendingDir: path.join(qaRoot, "queue", "events", "pending"),
      scopedRejectedDir: path.join(qaRoot, "queue", "events", "rejected"),
    };
    await Promise.all([
      fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
      fsp.mkdir(scope.scopedRejectedDir, { recursive: true }),
    ]);
    const run = await prepareV2CompetitionRun(config, scope, {
      developerOverride: true,
      runId: "run_real_automatic_qa",
    });
    const launch = buildMameArgs(run.config, loaded.pack.rom, "competition");
    const autobootScript = path.resolve(__dirname, "..", "..", "test", "support", "mame-0287-invaders-auto-capture-qa.lua");
    const markerPath = path.join(qaRoot, "reset.marker");
    const child = spawn(launch.command, [
      ...launch.args,
      "-video", "none",
      "-sound", "none",
      "-autoboot_delay", "0",
      "-autoboot_script", autobootScript,
    ], {
      cwd: launch.cwd,
      env: {
        ...process.env,
        HSL_AUTO_QA_MARKER: markerPath,
        HSL_AUTO_QA_VIOLATION: mode === "crash" ? "clean" : mode,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let candidateObservedBeforeClose = false;
    let candidateCheck = Promise.resolve();
    const collect = (chunk) => {
      const text = String(chunk);
      output += text;
      if (!candidateObservedBeforeClose && text.includes("Candidate escrito")) {
        candidateObservedBeforeClose = true;
        candidateCheck = (async () => {
          assert.equal((await listJson(run.stagingCandidatesDir)).length > 0, true);
          assert.deepEqual(await listJson(scope.scopedPendingDir), []);
          if (mode === "crash") child.kill();
        })();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("MAME automatic QA timeout"));
      }, 180_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => { clearTimeout(timeout); resolve(code ?? 1); });
    });
    await candidateCheck;
    if (mode === "crash") assert.notEqual(exitCode, 0, output);
    else assert.equal(exitCode, 0, output);
    assert.equal(candidateObservedBeforeClose, true, output);
    assert.match(output, /AUTOMATIC_FINAL/);
    if (mode === "clean") assert.match(output, /Integridad competitiva final: CLEAN/);

    const finalized = await finalizeCompetitionRun(run, scope, { exitCode });
    const expectedStatus = mode === "clean" ? "clean" : mode === "crash" ? "fail_closed" : "violated";
    assert.equal(finalized.status, expectedStatus, JSON.stringify(finalized, null, 2));
    assert.equal(finalized.adopted.length, mode === "clean" ? 1 : 0);
    assert.equal(finalized.rejected.length, mode === "clean" ? 0 : 1);
    assert.deepEqual(await listJson(scope.scopedPendingDir), mode === "clean" ? [finalized.adopted[0].filename] : []);
    const eventPath = mode === "clean" ? finalized.adopted[0].finalPath : finalized.rejected[0].finalPath;
    const event = JSON.parse(await fsp.readFile(eventPath, "utf8"));
    assert.equal(event.score > 0, true);
    assert.equal(event.detection.manualConfirm, false);

    process.stdout.write(`${JSON.stringify({
      candidateObservedBeforeClose,
      mode,
      pendingWhileOpen: 0,
      finalStatus: finalized.status,
      promotedAfterClose: finalized.adopted.length,
      rejected: finalized.rejected.length,
      violations: finalized.violations,
      score: event.score,
      strategy: run.automaticCaptureStrategy,
      manifestSha256: run.integrity.manifestSha256,
      provenance: run.provenance.mode,
    }, null, 2)}\n`);
  } finally {
    await fsp.rm(qaRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
