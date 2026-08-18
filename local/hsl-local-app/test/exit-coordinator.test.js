const test = require("node:test");
const assert = require("node:assert/strict");
const { createExitCoordinator } = require("../src/exit-coordinator");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("normal before-quit prevents once, drains once and arms one final quit", async () => {
  const gate = deferred();
  let drains = 0;
  let quits = 0;
  let prevented = 0;
  const coordinator = createExitCoordinator({
    drain: async () => { drains += 1; await gate.promise; },
    finalQuit: () => { quits += 1; },
  });
  assert.equal(coordinator.handleBeforeQuit({ preventDefault: () => { prevented += 1; } }), true);
  assert.equal(coordinator.handleBeforeQuit({ preventDefault: () => { prevented += 1; } }), true);
  assert.equal(coordinator.getState().phase, "draining");
  gate.resolve();
  await coordinator.requestExit();
  assert.equal(drains, 1);
  assert.equal(quits, 1);
  assert.equal(prevented, 2);
  assert.equal(coordinator.handleBeforeQuit({ preventDefault: () => { prevented += 1; } }), false);
  assert.equal(prevented, 2);
});

test("updater intent is only drained after quitAndInstall has requested app quit", async () => {
  const events = [];
  const coordinator = createExitCoordinator({
    drain: async (intent) => { events.push(`drain:${intent}`); },
    finalQuit: (intent) => { events.push(`quit:${intent}`); },
  });
  coordinator.setIntent("update");
  events.push("quitAndInstall");
  coordinator.handleBeforeQuit({ preventDefault: () => events.push("prevent") });
  await coordinator.requestExit();
  assert.deepEqual(events, ["quitAndInstall", "prevent", "drain:update", "quit:update"]);
});

test("failed install can clear update intent without draining live services", () => {
  let drains = 0;
  const coordinator = createExitCoordinator({ drain: () => { drains += 1; } });
  coordinator.setIntent("update");
  assert.equal(coordinator.clearIntent("update"), true);
  assert.equal(coordinator.getState().intent, "normal");
  assert.equal(coordinator.getState().phase, "idle");
  assert.equal(drains, 0);
});

