const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { classifyMembershipConnectivitySignal } = require("../src/remote-connectivity-signals");

const appRoot = path.join(__dirname, "..");
const rendererRoot = path.join(appRoot, "gui", "renderer");

function state(connectionStatus, capability, game = { weekId: "week-1" }) {
  return {
    connectivity: {
      displayStatus: connectionStatus,
      probe: { phase: "idle", inFlight: false },
      reachability: ["connected", "offline"].includes(connectionStatus) ? connectionStatus : "unknown",
      reachabilityGeneration: 1,
    },
    rankingCapabilities: {
      webBaseUrl: "https://hsl.example",
      entries: capability ? {
        "week-1": {
          weekId: "week-1",
          ...capability,
        },
      } : {},
    },
    rankingOpening: false,
  };
}

test("Ranking follows the complete connection and capability matrix", async () => {
  const { getRankingActionState } = await import(
    pathToFileURL(path.join(rendererRoot, "ranking-state.js")).href
  );

  assert.match(getRankingActionState(state("offline"), { weekId: "week-1" }).reason, /Necesitas conexion/);
  assert.match(getRankingActionState(state("connecting"), { weekId: "week-1" }).reason, /Comprobando conexion/);
  assert.match(getRankingActionState(state("connected", { status: "checking" }), { weekId: "week-1" }).reason, /disponibilidad/);
  assert.match(getRankingActionState(state("connected", { status: "unknown" }), { weekId: "week-1" }).reason, /No se pudo comprobar/);
  assert.match(getRankingActionState(state("connected", { status: "unavailable" }), { weekId: "week-1" }).reason, /todavia no esta disponible/);
  assert.equal(getRankingActionState(state("connected", {
    status: "available",
    url: "https://hsl.example/weeks/week-1",
  }), { weekId: "week-1" }).available, true);
  assert.match(getRankingActionState(state("connected"), { weekId: null }).reason, /no tiene un ranking configurado/);
});

test("confirmed ranking follows committed connectivity, identity and origin without a clock", async () => {
  const { getRankingActionState } = await import(
    pathToFileURL(path.join(rendererRoot, "ranking-state.js")).href
  );
  const available = {
    status: "available",
    url: "https://hsl.example/weeks/week-1",
    weekId: "week-1",
  };

  assert.equal(getRankingActionState(state("offline", available), { weekId: "week-1" }).available, false);
  assert.equal(getRankingActionState(state("connecting", available), { weekId: "week-1" }).available, false);
  const retry = state("connected", available);
  retry.connectivity.displayStatus = "reconnecting";
  retry.connectivity.probe = { phase: "retry", inFlight: true };
  assert.equal(getRankingActionState(retry, { weekId: "week-1" }).available, true);

  assert.equal(getRankingActionState(state("connected", { ...available, weekId: "week-2" }), { weekId: "week-1" }).available, false);
  assert.equal(getRankingActionState(state("connected", { ...available, expiresAt: "2000-01-01T00:00:00.000Z" }), { weekId: "week-1" }).available, true);
  assert.equal(getRankingActionState(state("connected", { ...available, url: "https://other.example/weeks/week-1" }), { weekId: "week-1" }).available, false);
});

test("canonical remote gate is shared by Ranking and future controls", async () => {
  const { deriveRemoteActionAvailability, deriveRemoteAvailability } = await import(
    pathToFileURL(path.join(rendererRoot, "remote-availability.js")).href
  );
  const connectivity = {
    displayStatus: "reconnecting",
    probe: { phase: "retry", inFlight: true },
    reachability: "connected",
    reachabilityGeneration: 7,
  };
  const remote = deriveRemoteAvailability(connectivity);
  const rankingGate = deriveRemoteActionAvailability(connectivity, []);
  const futureInstallGate = deriveRemoteActionAvailability(connectivity, []);
  assert.deepEqual(remote, { available: true, generation: 7, reason: null, status: "connected" });
  assert.deepEqual(rankingGate, futureInstallGate);
  assert.equal(deriveRemoteActionAvailability(connectivity, ["incompatible-pack"]).available, false);
});

test("renderer only signals network changes and never confirms connected", async () => {
  const app = await fsp.readFile(path.join(rendererRoot, "app.js"), "utf8");

  assert.match(app, /connectivity: null/);
  assert.match(app, /requestConnectivityRefresh\?\.\("renderer-offline"\)/);
  assert.match(app, /requestConnectivityRefresh\?\.\("renderer-online"\)/);
  assert.match(app, /navigator\.connection\?\.addEventListener/);
  assert.match(app, /navigator\.connection\?\.removeEventListener/);
  assert.doesNotMatch(app, /navigator\.onLine/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => store\.setState\(\{ connectionStatus: "connected"/);
  assert.match(app, /openRankingWithoutGlobalBusy/);
});

test("IPC is narrow, subscribable and exposes no arbitrary fetch", async () => {
  const [main, preload] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "preload.js"), "utf8"),
  ]);

  for (const channel of [
    "launcher:get-connectivity-state",
    "launcher:request-connectivity-refresh",
    "launcher:get-ranking-capabilities-state",
    "launcher:request-ranking-capabilities-refresh",
  ]) {
    assert.match(main, new RegExp(channel));
  }

  assert.match(main, /powerMonitor\.on\("resume"/);
  assert.match(main, /powerMonitor\.on\("suspend"/);
  assert.match(main, /mainWindow\.on\("focus"/);
  assert.match(main, /mainWindow\.on\("blur"/);
  assert.match(preload, /onConnectivityState/);
  assert.match(preload, /onRankingCapabilitiesState/);
  assert.doesNotMatch(preload, /fetch\s*:/);
  assert.doesNotMatch(preload, /request\(url|arbitrary|ipcRenderer\.invoke\([^,]+,\s*url/);
});

test("header shows only stable states with natural width and accessible refresh", async () => {
  const [header, styles, app, busyOverlay] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "busy-overlay.js"), "utf8"),
  ]);

  const connectionBlock = header.slice(header.indexOf("const headerStatus"), header.indexOf("const connectionChip"));
  assert.doesNotMatch(connectionBlock, /Conectando|Reconectando/);
  assert.match(header, /data-action="refresh-connectivity"/);
  assert.match(header, /aria-label="Comprobar conexi\\u00f3n"/);
  assert.match(header, /aria-disabled=/);
  assert.doesNotMatch(header, /connection-refresh-placeholder/);
  assert.doesNotMatch(header, /<button[^>]*connection-chip/);
  assert.match(styles, /\.connection-chip\s*\{[\s\S]*?display: inline-flex/);
  assert.doesNotMatch(styles, /174px/);
  assert.match(styles, /\.connection-label[\s\S]*white-space: nowrap/);
  assert.match(styles, /\.connection-refresh-button\s*\{[\s\S]*?border-radius: 999px;[\s\S]*?margin-inline-start: -4px;/);
  assert.match(styles, /\.connection-refresh-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.connection-refresh-button:focus-visible/);
  assert.match(app, /refresh-connectivity/);
  assert.match(app, /runWithOperationFeedback/);
  assert.match(app, /DEFAULT_OPERATION_MIN_VISIBLE_MS/);
  assert.match(busyOverlay, /Comprobando conexi\\u00f3n\.\.\./);
});

test("header selector hides unknown and ignores transient probe phases", async () => {
  const { deriveConnectivityHeaderState } = await import(
    pathToFileURL(path.join(rendererRoot, "connectivity-header-state.js")).href
  );

  assert.equal(deriveConnectivityHeaderState(null), "hidden");
  assert.equal(deriveConnectivityHeaderState(undefined), "hidden");
  assert.equal(deriveConnectivityHeaderState({}), "hidden");
  assert.equal(deriveConnectivityHeaderState({ reachability: "unknown" }), "hidden");
  assert.equal(deriveConnectivityHeaderState({
    reachability: "connected",
    probe: { phase: "manual", inFlight: true },
  }), "connected");
  assert.equal(deriveConnectivityHeaderState({
    reachability: "offline",
    probe: { phase: "retry", inFlight: true },
  }), "offline");
});

test("first header render tolerates null connectivity and keeps the chip hidden", async () => {
  const { renderHeader } = await import(
    pathToFileURL(path.join(rendererRoot, "components", "header.js")).href
  );

  const header = renderHeader({
    accountMenuOpen: false,
    busy: true,
    connectivity: null,
    data: null,
    theme: "dark",
  });

  assert.match(header, /High Score League Launcher/);
  assert.match(header, /data-action="toggle-theme"/);
  assert.doesNotMatch(header, /data-connectivity-status=/);
  assert.doesNotMatch(header, /connection-chip--connected|connection-chip--offline/);
});

test("pack activation preserves the previous snapshot and uses shared minimum feedback", async () => {
  const [app, gamePanel, main] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "game-panel.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
  ]);

  const activationBlock = app.slice(app.indexOf("async function activateLibraryPackWithPreload"), app.indexOf("function bindActions"));
  assert.match(activationBlock, /waitForMinimumVisibleDuration\(\{ minVisibleMs: DEFAULT_OPERATION_MIN_VISIBLE_MS/);
  assert.doesNotMatch(activationBlock, /data:\s*null|game:\s*null|activePack:\s*null/);
  assert.doesNotMatch(app, /neutralizeActivePackData|neutralizeActivePack/);
  assert.match(activationBlock, /refreshRemoteStateAfterPackActivation/);
  assert.match(main, /activateLibraryPack\(packId, \{[\s\S]*deferRemoteMembership: true/);
  assert.match(gamePanel, /shouldRenderLibraryBrandFallback/);
  assert.match(gamePanel, /if \(state\.libraryActivationInProgress\) return null/);
});

test("only a session-confirmed available capability reaches shell.openExternal", async () => {
  const main = await fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8");
  const rankingBlock = main.slice(main.indexOf('ipcMain.handle("launcher:open-ranking"'), main.indexOf('ipcMain.handle("launcher:check-membership"'));

  assert.doesNotMatch(rankingBlock, /connectivity\.refresh\("ranking-click"/);
  assert.match(rankingBlock, /trustedGlobalOrigin/);
  assert.match(rankingBlock, /deriveRemoteAvailability\(connectivity\.getState\(\)\)\.available/);
  assert.match(rankingBlock, /rankingCapabilities\.ensureCapability\(weekId\)/);
  assert.match(rankingBlock, /capability\.status !== "available"/);
  assert.ok(rankingBlock.indexOf("capability.status") < rankingBlock.indexOf("shell.openExternal(safeUrl)"));
});

test("renderer applies one committed connectivity snapshot to chip and Ranking", async () => {
  const [app, header, ranking] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "connectivity-header-state.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "ranking-state.js"), "utf8"),
  ]);
  const applyBlock = app.slice(app.indexOf("function applyConnectivityState"), app.indexOf("function applyRankingCapabilitiesState"));
  assert.match(applyBlock, /store\.setState\(\{ connectivity:/);
  assert.match(applyBlock, /nextGeneration < currentGeneration/);
  assert.match(applyBlock, /deriveRemoteAvailability\(appliedState\.connectivity\)/);
  assert.match(applyBlock, /getRankingActionState\(appliedState/);
  assert.match(header, /deriveRemoteAvailability/);
  assert.match(ranking, /deriveRemoteAvailability/);
  assert.doesNotMatch(ranking, /displayStatus|expiresAt|Date\.now/);
});

test("header and Ranking render the same committed gate for loss and recovery", async () => {
  const [{ renderHeader }, { renderGamePanel }] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "header.js")).href),
    import(pathToFileURL(path.join(rendererRoot, "components", "game-panel.js")).href),
  ]);
  const base = state("connected", {
    status: "available",
    url: "https://hsl.example/weeks/week-1",
  });
  base.busy = false;
  base.theme = "dark";
  base.data = {
    activePack: { instanceKey: "pack-1" },
    autoSync: { status: "idle" },
    bridge: {},
    game: { displayName: "Game", instanceKey: "pack-1", weekId: "week-1" },
    library: { directory: { available: true }, packs: [{ instanceKey: "pack-1" }], status: "available-populated" },
    membership: { canPlayCompetition: true },
    queue: { totals: { failed: 0, pending: 0, sent: 0 } },
    readiness: { canPlayCompetition: true, canPractice: true, status: "ready" },
    selection: { activeInstanceKey: "pack-1" },
    session: { hasSession: true },
  };

  base.connectivity.displayStatus = "reconnecting";
  base.connectivity.probe = { phase: "retry", inFlight: true };
  assert.match(renderHeader(base), /data-connectivity-status="connected"/);
  assert.doesNotMatch(renderGamePanel(base), /data-action="open-ranking"[^>]*disabled/);

  const offline = structuredClone(base);
  offline.connectivity.reachability = "offline";
  offline.connectivity.displayStatus = "offline";
  offline.connectivity.reachabilityGeneration += 1;
  assert.match(renderHeader(offline), /data-connectivity-status="offline"/);
  assert.match(renderGamePanel(offline), /data-action="open-ranking"[^>]*disabled/);

  const recovered = structuredClone(offline);
  recovered.connectivity.reachability = "connected";
  recovered.connectivity.displayStatus = "connected";
  recovered.connectivity.reachabilityGeneration += 1;
  assert.match(renderHeader(recovered), /data-connectivity-status="connected"/);
  assert.doesNotMatch(renderGamePanel(recovered), /data-action="open-ranking"[^>]*disabled/);
});

test("remote product errors do not become connectivity failures", () => {
  for (const status of ["not_member", "invalid_week", "unauthenticated", "error"]) {
    assert.equal(classifyMembershipConnectivitySignal({
      response: { httpStatus: status === "unauthenticated" ? 401 : 422 },
      status,
    }), "reachable");
  }

  for (const status of ["no_session", "missing_week", "unauthenticated"]) {
    assert.equal(classifyMembershipConnectivitySignal({ status }), "none");
  }

  assert.equal(classifyMembershipConnectivitySignal({ status: "unknown" }), "none");
  assert.equal(classifyMembershipConnectivitySignal({
    request: { url: "https://hsl.example/api/local/season-membership?weekId=week-1" },
    status: "unknown",
  }), "transport-failure");
  assert.equal(classifyMembershipConnectivitySignal({
    response: { httpStatus: 503 },
    status: "unknown",
  }), "reachable");
});
