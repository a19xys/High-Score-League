const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

test("competition wiring keeps candidates private and finalizes only after MAME closes", async () => {
  const launcher = await fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8");
  const competition = launcher.slice(
    launcher.indexOf("async function playCompetitionAction"),
    launcher.indexOf("async function playCompetition(options"),
  );

  const launch = competition.indexOf("launchMameDetailed(launchConfig");
  const finalize = competition.indexOf("finalizeCompetitionRun)(preparedRun");
  const notify = competition.indexOf('notifyScoreAdopted(options, adoption, "close")');
  assert.ok(launch >= 0);
  assert.ok(finalize > launch);
  assert.ok(notify > finalize);
  assert.doesNotMatch(competition, /createScoreCaptureConvergence|scoreCaptureMonitor/);
});

test("only post-close finalization and legacy close adoption emit the explicit score-adopted intent", async () => {
  const [launcher, main] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
  ]);

  assert.match(launcher, /notifyScoreAdopted\(options, adoption, "close"\)/);
  assert.doesNotMatch(launcher, /phase:\s*"live"/);
  assert.match(main, /onScoreAdopted: \(\) => schedulePendingAutoSubmit\("score-adopted"\)/);
  assert.match(main, /scoreAdoptedSubmitQueued = true/);
  assert.match(main, /drainQueuedScoreAdoptedSubmit\(\)/);
  assert.match(main, /scoreCapture: service\.getScoreCaptureConvergenceDiagnostics\(\)/);
});

test("post-MAME publication retains its no-incidental-auto-submit authority contract", async () => {
  const main = await fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8");
  const publication = main.slice(
    main.indexOf("async function publishCompletedMameState"),
    main.indexOf("function registerLauncherStateHandler"),
  );
  assert.match(publication, /scheduleAutoSubmit: false/);
  assert.match(publication, /publishPostMameConvergence/);
});
