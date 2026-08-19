const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { focusPrimaryWindow, installSingleInstancePolicy } = require("../gui/single-instance");

test("secondary instance exits before installing a focus handler", () => {
  const app = new EventEmitter();
  let additionalData;
  app.requestSingleInstanceLock = (value) => {
    additionalData = value;
    return false;
  };
  assert.equal(installSingleInstancePolicy(app, () => null, {
    additionalData: { packDeepLink: { packId: "foo", type: "import-pack", version: 1 } },
  }), false);
  assert.equal(additionalData.packDeepLink.packId, "foo");
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

test("primary recibe sólo el intent normalizado de additionalData y siempre enfoca", () => {
  const received = [];
  let focusCalls = 0;
  const window = {
    focus: () => { focusCalls += 1; },
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => {},
  };
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  installSingleInstancePolicy(app, () => window, { onPackDeepLink: (intent) => received.push(intent) });
  app.emit("second-instance", {}, ["launcher.exe"], ".", {});
  app.emit("second-instance", {}, ["launcher.exe"], ".", {
    packDeepLink: { packId: "space-invaders", type: "import-pack", version: 1 },
  });
  app.emit("second-instance", {}, ["launcher.exe"], ".", {
    packDeepLink: { packId: "space-invaders", rawUrl: "secret", type: "import-pack", version: 1 },
  });
  assert.equal(focusCalls, 3);
  assert.deepEqual(received, [{ packId: "space-invaders", type: "import-pack", version: 1 }]);
});
