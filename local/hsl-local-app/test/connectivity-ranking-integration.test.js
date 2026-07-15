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
    connectionStatus,
    connectivity: { status: connectionStatus },
    rankingCapabilities: {
      entries: capability ? { "week-1": capability } : {},
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

test("renderer only signals network changes and never confirms connected", async () => {
  const app = await fsp.readFile(path.join(rendererRoot, "app.js"), "utf8");

  assert.match(app, /connectionStatus: "connecting"/);
  assert.match(app, /requestConnectivityRefresh\?\.\("renderer-offline"\)/);
  assert.match(app, /requestConnectivityRefresh\?\.\("renderer-online"\)/);
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
  assert.match(main, /mainWindow\.on\("focus"/);
  assert.match(preload, /onConnectivityState/);
  assert.match(preload, /onRankingCapabilitiesState/);
  assert.doesNotMatch(preload, /fetch\s*:/);
  assert.doesNotMatch(preload, /request\(url|arbitrary|ipcRenderer\.invoke\([^,]+,\s*url/);
});

test("only a fresh available capability reaches shell.openExternal", async () => {
  const main = await fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8");
  const rankingBlock = main.slice(main.indexOf('ipcMain.handle("launcher:open-ranking"'), main.indexOf('ipcMain.handle("launcher:check-membership"'));

  assert.match(rankingBlock, /connectivity\.refresh\("ranking-click"/);
  assert.match(rankingBlock, /rankingCapabilities\.ensureCapability\(weekId\)/);
  assert.match(rankingBlock, /capability\.status !== "available"/);
  assert.ok(rankingBlock.indexOf("capability.status") < rankingBlock.indexOf("shell.openExternal(capability.url)"));
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
