const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

async function source(relativePath) {
  return fsp.readFile(path.join(__dirname, "..", relativePath), "utf8");
}

test("product requests can request a health confirmation but never commit connectivity", async () => {
  const main = await source("gui/main.js");
  assert.match(main, /requestConnectivityConfirmation\("membership-product-signal"\)/);
  assert.match(main, /requestConnectivityConfirmation\("ranking-product-signal"\)/);
  assert.doesNotMatch(main, /markReachable\("membership-response"/);
  assert.doesNotMatch(main, /signalOffline\("membership-transport"/);
  assert.doesNotMatch(main, /signalOffline\("auto-submit-transport"/);
  assert.doesNotMatch(main, /onReachable:\s*\([^)]*\)\s*=>\s*connectivity\.markReachable/);
  assert.doesNotMatch(main, /connectivity\.markReachable/);
  assert.doesNotMatch(main, /connectivity\.signalOffline/);
});

test("suspend and shutdown abort product operations and no legacy GUI submit path remains", async () => {
  const [main, service, renderer] = await Promise.all([
    source("gui/main.js"),
    source("gui/launcher-service.js"),
    source("gui/renderer/app.js"),
  ]);
  assert.match(main, /productOperationsController\.abort\("suspend"\)/);
  assert.match(main, /productOperationsController\.abort\("shutdown"\)/);
  assert.match(main, /setRemoteOperationSignalProvider/);
  assert.doesNotMatch(service, /submitAllPending/);
  assert.doesNotMatch(renderer, /"submit-all"/);
  assert.match(service, /invalidateInteractiveRemoteOperations/);
  const switchBlock = main.slice(main.indexOf('ipcMain.handle("launcher:switch-account"'), main.indexOf('ipcMain.handle("launcher:use-library-pack"'));
  assert.match(switchBlock, /invalidateInteractiveRemoteOperations/);
  assert.doesNotMatch(switchBlock, /cancelPendingAutoSubmit/);
});

test("single-instance lock precedes ready startup and membership opening revalidates origin", async () => {
  const main = await source("gui/main.js");
  assert.ok(main.indexOf("installSingleInstancePolicy") < main.indexOf("app.whenReady()"));
  assert.match(main, /safeMembershipJoinUrl/);
  assert.match(main, /requestSingleInstanceLock|installSingleInstancePolicy/);
});

test("renderer and topology can commit offline only after main verifies net.isOnline false", async () => {
  const main = await source("gui/main.js");
  const rendererSignal = main.slice(
    main.indexOf('ipcMain.handle("launcher:request-connectivity-refresh"'),
    main.indexOf('ipcMain.handle("launcher:get-ranking-capabilities-state"'),
  );
  assert.match(rendererSignal, /renderer-offline[\s\S]*!net\.isOnline\(\)[\s\S]*confirmSystemOffline/);
  assert.match(rendererSignal, /connectivity\.refresh\(safeReason, \{ force: true, phase: "background" \}\)/);
  const topology = main.slice(main.indexOf("topologyMonitor = createNetworkTopologyMonitor"), main.indexOf("pendingAutoSubmitCoordinator = createPendingAutoSubmitCoordinator"));
  assert.match(topology, /externalAddressCount === 0 && !net\.isOnline\(\)/);
  assert.match(topology, /confirmSystemOffline\("topology-change"\)/);
  assert.match(topology, /connectivity\.refresh\("topology-change"/);
});

test("only the developer-gated force action can reset auto-submit guards", async () => {
  const main = await source("gui/main.js");
  const forceHandler = main.slice(
    main.indexOf('ipcMain.handle("launcher:force-account-sync"'),
    main.indexOf('ipcMain.handle("launcher:restore-failed"'),
  );
  assert.match(forceHandler, /runDeveloperOnlyOperation\(developerToolsEnabled/);
  assert.match(forceHandler, /cancelCurrentRun\("development-force"\)/);
  assert.match(forceHandler, /resetGuards\("development-force"\)/);
  assert.doesNotMatch(forceHandler, /devBridge/);
  assert.equal((main.match(/\.resetGuards\(/g) || []).length, 1);
});
