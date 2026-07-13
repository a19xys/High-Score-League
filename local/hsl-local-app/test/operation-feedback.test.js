const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

test("minimum visible feedback waits only for the remaining duration", async () => {
  const { remainingMinimumVisibleMs, waitForMinimumVisibleDuration } = await import(
    pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href
  );
  const waits = [];

  assert.equal(remainingMinimumVisibleMs(1000, 600, 1150), 450);
  assert.equal(remainingMinimumVisibleMs(1000, 600, 1700), 0);

  const waited = await waitForMinimumVisibleDuration({
    minVisibleMs: 600,
    now: () => 1150,
    startedAt: 1000,
    wait: async (duration) => waits.push(duration),
  });

  assert.equal(waited, 450);
  assert.deepEqual(waits, [450]);

  const completedWithoutTimer = await waitForMinimumVisibleDuration({
    minVisibleMs: 600,
    now: () => 1700,
    startedAt: 1000,
    wait: async () => assert.fail("no debe crear un timer si el mínimo ya se cumplió"),
  });
  assert.equal(completedWithoutTimer, 0);
});

test("explicit rescan integrates shared minimum feedback on success and error", async () => {
  const app = await fsp.readFile(path.join(rendererRoot, "app.js"), "utf8");

  assert.match(app, /import \{ waitForMinimumVisibleDuration \} from "\.\/operation-feedback\.js"/);
  assert.match(app, /const busyStartedAt = Date\.now\(\)/);
  assert.match(app, /try \{[\s\S]*await waitForMinimumVisibleDuration\(\{[\s\S]*startedAt: busyStartedAt/);
  assert.match(app, /catch \(error\) \{[\s\S]*await waitForMinimumVisibleDuration\(\{[\s\S]*startedAt: busyStartedAt/);
  assert.match(app, /action === "rescan-pack-directory"[\s\S]*minVisibleMs: 600/);
  assert.match(app, /runId !== busyRunSequence/);
});
