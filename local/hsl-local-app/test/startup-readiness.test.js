const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const moduleUrl = pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "startup-readiness.js"));

function clock() {
  let current = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    clearTimeout(id) { timers.delete(id); },
    now: () => current,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { at: current + delay, callback });
      return id;
    },
    tick(ms) {
      current += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= current && timers.delete(id)) timer.callback();
      }
    },
    timerCount: () => timers.size,
  };
}

test("theme, shell, local state, library, selection and critical assets gate ready", async () => {
  const { createStartupReadiness } = await import(moduleUrl);
  const fake = clock();
  const updates = [];
  const readiness = createStartupReadiness({
    clearTimeoutImpl: fake.clearTimeout,
    maxWaitMs: 4_000,
    minVisibleMs: 250,
    now: fake.now,
    onChange: (state) => updates.push(state),
    setTimeoutImpl: fake.setTimeout,
  });
  readiness.mark("shell");
  readiness.mark("localState");
  readiness.mark("library");
  readiness.mark("selection");
  assert.equal(readiness.getState().visible, true);
  readiness.mark("criticalAssets");
  fake.tick(249);
  assert.equal(readiness.getState().visible, true);
  fake.tick(1);
  assert.equal(readiness.getState().status, "ready");
  assert.equal(readiness.getState().visible, false);
  assert.equal(updates.filter((state) => !state.visible).length, 1);
});

test("empty and inaccessible libraries have definitive startup presentations", async () => {
  const { classifyStartupSnapshot } = await import(moduleUrl);
  assert.deepEqual(classifyStartupSnapshot({ library: { packs: [], status: "available-empty" }, selection: {} }), {
    library: "ready",
    selection: "fallback",
  });
  assert.deepEqual(classifyStartupSnapshot({ library: { packs: [], status: "inaccessible" }, selection: {} }), {
    library: "degraded",
    selection: "fallback",
  });
});

test("broken assets can fall back and timeout forces one bounded degraded completion", async () => {
  const { createStartupReadiness } = await import(moduleUrl);
  const fallbackClock = clock();
  const fallback = createStartupReadiness({ clearTimeoutImpl: fallbackClock.clearTimeout, minVisibleMs: 0, now: fallbackClock.now, setTimeoutImpl: fallbackClock.setTimeout });
  for (const phase of ["shell", "localState", "library", "selection"]) fallback.mark(phase);
  fallback.mark("criticalAssets", "fallback");
  assert.equal(fallback.getState().status, "ready");

  const timeoutClock = clock();
  const timeout = createStartupReadiness({ clearTimeoutImpl: timeoutClock.clearTimeout, maxWaitMs: 100, minVisibleMs: 0, now: timeoutClock.now, setTimeoutImpl: timeoutClock.setTimeout });
  timeout.mark("shell");
  timeoutClock.tick(100);
  assert.equal(timeout.getState().status, "degraded");
  assert.equal(timeout.getState().reason, "startup-timeout");
  assert.equal(timeout.mark("criticalAssets"), false);
  assert.equal(timeoutClock.timerCount(), 0);
});

test("remote concerns are absent from the startup gate", async () => {
  const { startupReadinessTestApi } = await import(moduleUrl);
  assert.equal(startupReadinessTestApi.REQUIRED_PHASES.includes("health"), false);
  assert.equal(startupReadinessTestApi.REQUIRED_PHASES.includes("ranking"), false);
  assert.equal(startupReadinessTestApi.REQUIRED_PHASES.includes("membership"), false);
});
