const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.join(__dirname, "..");

test("main owns initial membership convergence and committed connectivity triggers it", async () => {
  const [main, service, renderer] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "renderer", "app.js"), "utf8"),
  ]);

  assert.match(main, /createMembershipStartupCoordinator\(\{/);
  assert.match(main, /execute: \(\{ signal \}\) => service\.getLauncherState\(\{ connected: true, signal \}\)/);
  assert.match(main, /membershipStartupCoordinator\?\.observeState\(state/);
  assert.match(main, /membershipStartupCoordinator\?\.updateConnectivity/);
  assert.match(main, /function coordinateMembershipResult\(value, trigger, revision, options = \{\}\)/);
  assert.match(main, /isLauncherSnapshot\(value\?\.state\)/);
  assert.match(main, /!launcherStateAuthority\.acceptEffects\(numericRevision\)/);
  assert.match(main, /coordinateMembershipResult\(value, `ipc:\$\{channel\}`, revision\)/);
  assert.match(main, /launcher:get-initial-state[\s\S]*deferRemoteMembership: true/);
  assert.match(main, /launcher:get-state[\s\S]{0,180}deferRemoteMembership: true/);
  assert.match(service, /connected: options\.connected === true,[\s\S]*signal: options\.signal/);
  assert.match(service, /const deferRemoteMembership = options\.connected !== true && options\.deferRemoteMembership !== false/);
  assert.match(service, /const remoteSignal = combineAbortSignals\(\[[\s\S]*options\.signal,[\s\S]*interactiveRemoteController\.signal/);
  assert.match(service, /getAuthState\(runtimeConfig, \{[\s\S]*signal: remoteSignal\.signal/);
  assert.match(service, /checkSeasonMembership\(baseConfig, session, \{[\s\S]*signal: remoteSignal\.signal/);
  assert.match(service, /finally \{[\s\S]*remoteSignal\.dispose\(\)/);
  assert.match(service, /async function playPractice[\s\S]*getLauncherContext\(\{ deferRemoteMembership: true \}\)/);
  assert.match(service, /async function recheckSeasonMembership[\s\S]*getLauncherState\(\{ connected: true \}\)/);
  assert.doesNotMatch(renderer, /renderGamePanel[\s\S]{0,200}checkMembership|renderGamePanel[\s\S]{0,200}getState/);
});

test("checking snapshots and final results use the existing monotonic authority", async () => {
  const [main, coordinator] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "src", "membership-startup-coordinator.js"), "utf8"),
  ]);

  assert.match(main, /reserveRevision: \(\) => launcherStateAuthority\.reserveRevision\(\)/);
  assert.match(main, /launcherStateAuthority\.publishSnapshot\(syncedState, resolution\.revision\)/);
  assert.match(main, /publish\(state, resolution\) \{[\s\S]*if \(!launcherStateAuthority\.acceptEffects\(resolution\.revision\)\) return;/);
  assert.match(main, /sendRendererEvent\("launcher:state"/);
  assert.match(coordinator, /contextCurrent: true/);
  assert.match(coordinator, /accountId:[\s\S]*instanceKey:[\s\S]*weekId:/);
  assert.match(coordinator, /reachabilityGeneration/);
  assert.match(coordinator, /AbortController/);
  assert.match(coordinator, /DEFAULT_REMOTE_REQUEST_TIMEOUT_MS/);
  assert.doesNotMatch(coordinator, /setInterval/);
  assert.match(coordinator, /options\.setTimeout \|\| setTimeout/);
  assert.match(coordinator, /options\.clearTimeout \|\| clearTimeout/);
});

test("main rejects Jugar while automatic or manual membership resolution is active", async () => {
  const [main, membership] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "src", "season-membership.js"), "utf8"),
  ]);
  const playBlock = main.slice(
    main.indexOf('registerLauncherStateHandler("launcher:play-competition"'),
    main.indexOf('registerLauncherStateHandler("launcher:practice"'),
  );

  assert.match(playBlock, /membershipStartupCoordinator\?\.isActive\(\) \|\| membershipCoordinationPaused\(\)/);
  assert.match(playBlock, /ok: false/);
  assert.match(playBlock, /Comprobando participación\./);
  assert.ok(playBlock.indexOf("isActive") < playBlock.indexOf("service.playCompetition"));
  assert.match(membership, /BLOCKING_STATUSES = new Set\(\["checking"/);
});

test("identity and lifecycle changes pause and invalidate the one active pipeline", async () => {
  const main = await fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8");
  for (const reason of [
    "remove-account",
    "open-pack",
    "pack-directory-change",
    "import-pack",
    "pack-rescan",
    "pack-change",
    "logout",
  ]) {
    assert.match(main, new RegExp(`withMembershipContextMutation\\(\\s*\"${reason}\"`));
  }
  assert.match(main, /withAccountProfileRefreshAfterMutation\("login"/);
  assert.match(main, /withAccountProfileRefreshAfterMutation\("switch-account"/);
  assert.match(main, /withAccountProfileRefreshAfterMutation[\s\S]*operation: \(\) => withMembershipContextMutation\(reason, operation\)/);
  assert.match(main, /async function withMembershipContextMutation[\s\S]*invalidateMembershipContext\(reason\)[\s\S]*activeMembershipContextMutations\.add\(runId\)[\s\S]*finally[\s\S]*activeMembershipContextMutations\.delete\(runId\)/);
  assert.match(main, /function membershipCoordinationPaused\(\)[\s\S]*activeManualMembershipRun !== null \|\| activeMembershipContextMutations\.size > 0/);
  assert.match(main, /membershipStartupCoordinator\?\.resume\("resume"\)/);
  assert.match(main, /membershipStartupCoordinator\?\.shutdown\("shutdown"\)/);
  assert.match(main, /productOperationsController\.abort\("suspend"\)/);
  assert.match(main, /productOperationsController\.abort\("shutdown"\)/);
});

test("manual membership recheck is explicit, bounded and cannot race the startup coordinator", async () => {
  const main = await fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8");
  const block = main.slice(
    main.indexOf('registerLauncherStateHandler("launcher:check-membership"'),
    main.indexOf('registerLauncherStateHandler("launcher:diagnose"'),
  );

  assert.match(block, /const stableState = membershipStartupCoordinator\?\.invalidate\("manual-membership"\) \|\| null/);
  assert.match(block, /cancelManualMembershipRun\("manual-membership"\)/);
  assert.match(block, /activeManualMembershipRun = \{ connectionGeneration: null, contextKey: null, runId \}/);
  assert.match(block, /activeManualMembershipRun\.contextKey = contextKey/);
  assert.match(block, /preparedConnection\?\.reachability !== "connected"/);
  assert.match(block, /finalConnection\.reachability !== "connected"/);
  assert.match(block, /resultContextKey !== contextKey/);
  assert.match(block, /finally[\s\S]*activeManualMembershipRun\?\.runId === runId/);
  assert.equal((block.match(/service\.recheckSeasonMembership\(\)/g) || []).length, 1);

  assert.match(main, /options\.coordinateMembership === false \|\| membershipCoordinationPaused\(\)/);
  assert.match(main, /if \(!membershipCoordinationPaused\(\)\) \{[\s\S]*membershipStartupCoordinator\?\.updateConnectivity/);
});
