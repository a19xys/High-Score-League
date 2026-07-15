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
  const [app, overlay] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "busy-overlay.js"), "utf8"),
  ]);

  assert.match(app, /runWithOperationFeedback/);
  assert.match(app, /const busyStartedAt = Date\.now\(\)/);
  assert.match(app, /await runWithOperationFeedback\(\{[\s\S]*startedAt: busyStartedAt/);
  assert.match(app, /scope: options\.scope \|\| "transient"/);
  assert.doesNotMatch(app, /action === "rescan-pack-directory"[\s\S]{0,250}minVisibleMs: 600/);
  assert.match(app, /runId !== busyRunSequence/);
  assert.match(app, /Creando diagn\\u00f3stico/);
  assert.match(app, /scope: "interactive"/);
  assert.match(app, /scope: "external"/);
  assert.match(overlay, /Creando diagn\\u00f3stico\.\.\./);
});

test("operation lifecycle applies the global minimum on success and error", async () => {
  const {
    DEFAULT_OPERATION_MIN_VISIBLE_MS,
    runWithOperationFeedback,
  } = await import(pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href);
  assert.equal(DEFAULT_OPERATION_MIN_VISIBLE_MS, 600);

  for (const elapsed of [50, 599, 600, 4_000]) {
    let now = 1_000;
    const waits = [];
    const result = await runWithOperationFeedback({
      now: () => now,
      operation: async () => {
        now += elapsed;
        return "ok";
      },
      wait: async (duration) => {
        waits.push(duration);
        now += duration;
      },
    });
    assert.equal(result, "ok");
    assert.deepEqual(waits, elapsed < 600 ? [600 - elapsed] : []);
  }

  let now = 2_000;
  const waits = [];
  await assert.rejects(runWithOperationFeedback({
    now: () => now,
    operation: async () => {
      now += 100;
      throw new Error("failure");
    },
    wait: async (duration) => waits.push(duration),
  }), /failure/);
  assert.deepEqual(waits, [500]);
});

test("interactive, external and background scopes do not add delay", async () => {
  const { runWithOperationFeedback } = await import(
    pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href
  );
  for (const scope of ["interactive", "external", "background"]) {
    await runWithOperationFeedback({
      operation: async () => {},
      scope,
      wait: async () => assert.fail(`${scope} must not wait`),
    });
  }
});

test("stale operations cannot finish a newer feedback run", async () => {
  const { runWithOperationFeedback } = await import(
    pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href
  );
  let finished = false;
  await runWithOperationFeedback({
    isCurrent: () => false,
    minVisibleMs: 0,
    onFinish: () => { finished = true; },
    operation: async () => "stale",
  });
  assert.equal(finished, false);
});
