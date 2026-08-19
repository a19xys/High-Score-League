const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

test("competition wiring starts v2 convergence before MAME and always closes it", async () => {
  const launcher = await fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8");
  const competition = launcher.slice(
    launcher.indexOf("async function playCompetitionAction"),
    launcher.indexOf("async function playCompetition(options"),
  );

  const create = competition.indexOf("createScoreCaptureConvergence");
  const start = competition.indexOf("scoreCaptureMonitor.start()");
  const launch = competition.indexOf("launchMameDetailed(launchConfig");
  const close = competition.indexOf("scoreCaptureMonitor.close({ finalRescan: mameSpawned })");
  assert.ok(create >= 0);
  assert.ok(create < start);
  assert.ok(start < launch);
  assert.ok(launch < close);
  assert.match(competition, /finally \{[\s\S]*scoreCaptureMonitor\.close/);
});

test("v2 live adoption and legacy close adoption emit the explicit score-adopted intent", async () => {
  const [launcher, main] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
  ]);

  assert.match(launcher, /onAdopted\(event\) \{[\s\S]*options\.onScoreAdopted\?\.\(event\)/);
  assert.match(launcher, /if \(!isPackV2\) notifyScoreAdopted\(options, adoption, "close"\)/);
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
