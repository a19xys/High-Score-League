const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => () => ipcRenderer.invoke(channel);
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
  diagnose: invoke("launcher:diagnose"),
  getAuthState: invoke("launcher:get-auth-state"),
  getConnectivityState: invoke("launcher:get-connectivity-state"),
  getRankingCapabilitiesState: invoke("launcher:get-ranking-capabilities-state"),
  getState: invoke("launcher:get-state"),
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
  playCompetition: invoke("launcher:play-competition"),
  practice: invoke("launcher:practice"),
  openRanking: invoke("launcher:open-ranking"),
  removeKnownAccount: (userId) => ipcRenderer.invoke("launcher:remove-known-account", userId),
  requestConnectivityRefresh: (reason) => ipcRenderer.invoke("launcher:request-connectivity-refresh", reason),
  requestRankingCapabilitiesRefresh: invoke("launcher:request-ranking-capabilities-refresh"),
  rescanPackDirectory: invoke("launcher:rescan-pack-directory"),
  restoreFailed: (filename) => ipcRenderer.invoke("launcher:restore-failed", filename),
  setLibraryPreferences: (patch) => ipcRenderer.invoke("launcher:set-library-preferences", patch),
  switchAccount: (userId) => ipcRenderer.invoke("launcher:switch-account", userId),
  toggleLibraryFavorite: (packKey) => ipcRenderer.invoke("launcher:toggle-library-favorite", packKey),
  useSuggestedPackDirectory: (directoryPath) => ipcRenderer.invoke("launcher:use-suggested-pack-directory", directoryPath),
  useLibraryPack: (packId) => ipcRenderer.invoke("launcher:use-library-pack", packId),
  submitAll: invoke("launcher:submit-all"),
  syncPlugin: invoke("launcher:sync-plugin"),
});
