const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const {
  deriveDeveloperToolsEnabled,
  runDeveloperOnlyOperation,
} = require("../src/developer-tools");

test("developer tools depend only on packaging and the explicit override", () => {
  assert.equal(deriveDeveloperToolsEnabled({ environment: {}, isPackaged: false }), true);
  assert.equal(deriveDeveloperToolsEnabled({ environment: {}, isPackaged: true }), false);
  assert.equal(deriveDeveloperToolsEnabled({
    environment: { HSL_DEVELOPER_TOOLS: "1" },
    isPackaged: true,
  }), true);
  assert.equal(deriveDeveloperToolsEnabled({
    environment: { HSL_DEVELOPER_TOOLS: "0" },
    isPackaged: false,
  }), true);
});

test("the main-process guard rejects before running an administrative operation", async () => {
  let calls = 0;
  const blocked = await runDeveloperOnlyOperation(false, async () => { calls += 1; });
  assert.deepEqual(blocked, { allowed: false, value: null });
  assert.equal(calls, 0);

  const allowed = await runDeveloperOnlyOperation(true, async () => {
    calls += 1;
    return "done";
  });
  assert.deepEqual(allowed, { allowed: true, value: "done" });
  assert.equal(calls, 1);
});

test("administrative controls are independent from devBridge", async () => {
  const modulePath = path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js");
  const { renderDevTools } = await import(pathToFileURL(modulePath).href);
  const render = (developerToolsEnabled, devBridge) => renderDevTools({
    busy: false,
    connectivity: { reachability: "connected" },
    data: { bridge: { devBridge }, developerToolsEnabled },
  });

  assert.doesNotMatch(render(false, true), /force-account-sync|force-ranking-refresh/);
  assert.match(render(true, false), /force-account-sync/);
  assert.match(render(true, false), /force-ranking-refresh/);
  assert.match(render(true, false), /data-action="sync-plugin" disabled/);
});
