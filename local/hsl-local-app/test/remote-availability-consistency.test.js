const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  deriveRemoteActionAvailability,
  deriveRemoteAvailability,
} = require("../gui/shared/remote-availability");

const appRoot = path.join(__dirname, "..");

test("library classifications cannot change canonical HSL availability", () => {
  const connectivity = {
    displayStatus: "reconnecting",
    probe: { phase: "retry", inFlight: true },
    reachability: "connected",
    reachabilityGeneration: 12,
  };
  for (const classification of ["empty", "missing", "pack-root", "inside-pack", "unsupported-layout", "available-empty", "canceled"]) {
    const launcherState = { library: { directory: { classification } } };
    assert.ok(launcherState.library.directory.classification);
    assert.deepEqual(deriveRemoteAvailability(connectivity), {
      available: true,
      generation: 12,
      reason: null,
      status: "connected",
    });
  }
});

test("probe phases and displayStatus never close the committed gate", () => {
  for (const phase of ["manual", "retry", "background"]) {
    const remote = deriveRemoteAvailability({
      displayStatus: "reconnecting",
      probe: { inFlight: true, phase },
      reachability: "connected",
      reachabilityGeneration: 4,
    });
    assert.equal(remote.available, true);
    assert.equal(remote.status, "connected");
  }
  assert.equal(deriveRemoteAvailability({ reachability: "offline" }).available, false);
  assert.equal(deriveRemoteAvailability(null).status, "unknown");
});

test("all class A renderer controls use the shared remote selector", async () => {
  const [header, ranking, devTools] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "renderer", "components", "header.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "renderer", "ranking-state.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "renderer", "components", "dev-tools.js"), "utf8"),
  ]);
  assert.match(header, /deriveRemoteAvailability/);
  assert.match(ranking, /deriveRemoteAvailability/);
  assert.match(devTools, /deriveRemoteAvailability/);
  assert.match(devTools, /check-membership[\s\S]*!remoteAvailable/);
  assert.match(devTools, /force-ranking-refresh/);
  assert.equal(deriveRemoteActionAvailability({ reachability: "connected" }, []).available, true);
  assert.equal(deriveRemoteActionAvailability({ reachability: "offline" }, []).available, false);
});

test("main owns one global origin and never derives health from launcher state", async () => {
  const [main, service, config] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "src", "config.js"), "utf8"),
  ]);
  const syncBlock = main.slice(main.indexOf("function syncRemoteContext"), main.indexOf("async function withRemoteContext"));
  assert.doesNotMatch(syncBlock, /setWebBaseUrl|state\.bridge/);
  assert.match(syncBlock, /webBaseUrl: trustedHslOrigin/);
  assert.match(main, /trustedHslOrigin = bootstrap\.hslOrigin/);
  assert.match(service, /hslOrigin: config\.hslOrigin \|\| null/);
  assert.match(config, /hslOrigin,/);
  assert.doesNotMatch(config, /webBaseUrl: config\.webBaseUrl \|\| pack/);
});

test("main audits stable versus committed connectivity without changing the internal helper", async () => {
  const [main, connectivityState] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "src", "connectivity-state.js"), "utf8"),
  ]);
  assert.doesNotMatch(main, /isStableConnected/);
  assert.match(main, /isCommittedConnected/);
  assert.match(connectivityState, /function isStableConnected/);
  assert.match(connectivityState, /function isCommittedConnected/);
});

test("administrative IPC and controls use developerToolsEnabled instead of devBridge", async () => {
  const [main, devTools] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "renderer", "components", "dev-tools.js"), "utf8"),
  ]);
  const handler = main.slice(main.indexOf('ipcMain.handle("launcher:request-ranking-capabilities-refresh"'), main.indexOf('ipcMain.handle("launcher:get-auth-state"'));
  assert.match(handler, /runDeveloperOnlyOperation\(developerToolsEnabled/);
  assert.doesNotMatch(handler, /devBridge/);
  assert.match(handler, /rankingCapabilities\.forceRefresh/);
  assert.match(devTools, /developerToolsEnabled/);
  assert.match(devTools, /Forzar comprobacion de rankings/);
});
