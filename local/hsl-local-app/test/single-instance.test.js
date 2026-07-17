const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { focusPrimaryWindow, installSingleInstancePolicy } = require("../gui/single-instance");

test("secondary instance exits before installing a focus handler", () => {
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => false;
  assert.equal(installSingleInstancePolicy(app, () => null), false);
  assert.equal(app.listenerCount("second-instance"), 0);
});

test("second instance restores, shows and focuses the primary window", () => {
  const calls = [];
  const window = {
    focus: () => calls.push("focus"),
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
  };
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  assert.equal(installSingleInstancePolicy(app, () => window), true);
  app.emit("second-instance");
  assert.deepEqual(calls, ["restore", "show", "focus"]);
  assert.equal(focusPrimaryWindow({ isDestroyed: () => true }), false);
});
