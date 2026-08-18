const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => () => ipcRenderer.invoke(channel);
const argumentValue = (name) => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
};
const startupTheme = argumentValue("hsl-startup-theme") === "light" ? "light" : "dark";
const legacyThemeMigrationAllowed = argumentValue("hsl-legacy-theme-migration") === "1";
const productVersion = argumentValue("hsl-product-version") || "0.0.0";
const onEvent = (channel, callback) => {
  if (typeof callback !== "function") {
    return () => {};
  }

  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("hslLauncher", {
  choosePackDirectory: invoke("launcher:choose-pack-directory"),
  chooseSharedMameRuntime: invoke("launcher:choose-shared-mame-runtime"),
  checkMembership: invoke("launcher:check-membership"),
  acceptWindowsUpdate: invoke("launcher:accept-windows-update"),
  declineWindowsUpdate: invoke("launcher:decline-windows-update"),
  diagnose: invoke("launcher:diagnose"),
  detectLibraryLocation: (candidatePath) => ipcRenderer.invoke("launcher:detect-library-location", candidatePath),
  getAuthState: invoke("launcher:get-auth-state"),
  getConnectivityState: invoke("launcher:get-connectivity-state"),
  getRankingCapabilitiesState: invoke("launcher:get-ranking-capabilities-state"),
  getState: invoke("launcher:get-state"),
  getInitialState: invoke("launcher:get-initial-state"),
  getWindowsUpdateState: invoke("launcher:get-windows-update-state"),
  forceAccountSync: invoke("launcher:force-account-sync"),
  importPackFolder: invoke("launcher:import-pack-folder"),
  importPackZip: invoke("launcher:import-pack-zip"),
  login: (email, password) => ipcRenderer.invoke("launcher:login", { email, password }),
  logout: invoke("launcher:logout"),
  openPackDirectory: invoke("launcher:open-pack-directory"),
  openSharedMameRuntime: invoke("launcher:open-shared-mame-runtime"),
  openPack: invoke("launcher:open-pack"),
  openMembershipUrl: invoke("launcher:open-membership-url"),
  openManual: invoke("launcher:open-manual"),
  onBusyPhase: (callback) => onEvent("launcher:busy-phase", callback),
  onConnectivityState: (callback) => onEvent("launcher:connectivity-state", callback),
  onLauncherState: (callback) => onEvent("launcher:state", callback),
  onRankingCapabilitiesState: (callback) => onEvent("launcher:ranking-capabilities-state", callback),
  onWindowsUpdateState: (callback) => onEvent("launcher:windows-update-state", callback),
  playCompetition: invoke("launcher:play-competition"),
  platform: process.platform,
  productVersion,
  practice: invoke("launcher:practice"),
  openRanking: invoke("launcher:open-ranking"),
  removeKnownAccount: (userId) => ipcRenderer.invoke("launcher:remove-known-account", userId),
  requestConnectivityRefresh: (reason) => ipcRenderer.invoke("launcher:request-connectivity-refresh", reason),
  reportConnectivityApplied: (timing) => ipcRenderer.send("launcher:connectivity-applied", timing),
  reportRankingApplied: (timing) => ipcRenderer.send("launcher:ranking-applied", timing),
  reportStartupMilestone: (milestone) => ipcRenderer.send("launcher:startup-milestone", milestone),
  resolveThemeBootstrap: (legacyTheme) => ipcRenderer.sendSync("launcher:resolve-theme-bootstrap", legacyTheme),
  requestRankingCapabilitiesRefresh: invoke("launcher:request-ranking-capabilities-refresh"),
  rescanPackDirectory: invoke("launcher:rescan-pack-directory"),
  restoreFailed: (filename) => ipcRenderer.invoke("launcher:restore-failed", filename),
  setLibraryPreferences: (patch) => ipcRenderer.invoke("launcher:set-library-preferences", patch),
  setTheme: (theme, scopeKey) => ipcRenderer.invoke("launcher:set-theme", { scopeKey, theme }),
  startupTheme: Object.freeze({
    effectiveTheme: startupTheme,
    legacyThemeMigrationAllowed,
  }),
  switchAccount: (userId) => ipcRenderer.invoke("launcher:switch-account", userId),
  toggleLibraryFavorite: (packKey) => ipcRenderer.invoke("launcher:toggle-library-favorite", packKey),
  useLibraryPack: (packId) => ipcRenderer.invoke("launcher:use-library-pack", packId),
  syncPlugin: invoke("launcher:sync-plugin"),
});
