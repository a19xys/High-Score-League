const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => () => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld("hslLauncher", {
  choosePackDirectory: invoke("launcher:choose-pack-directory"),
  chooseSharedMameRuntime: invoke("launcher:choose-shared-mame-runtime"),
  checkMembership: invoke("launcher:check-membership"),
  diagnose: invoke("launcher:diagnose"),
  getAuthState: invoke("launcher:get-auth-state"),
  getState: invoke("launcher:get-state"),
  login: (email, password) => ipcRenderer.invoke("launcher:login", { email, password }),
  logout: invoke("launcher:logout"),
  openPackDirectory: invoke("launcher:open-pack-directory"),
  openSharedMameRuntime: invoke("launcher:open-shared-mame-runtime"),
  openPack: invoke("launcher:open-pack"),
  openMembershipUrl: invoke("launcher:open-membership-url"),
  playCompetition: invoke("launcher:play-competition"),
  practice: invoke("launcher:practice"),
  removeKnownAccount: (userId) => ipcRenderer.invoke("launcher:remove-known-account", userId),
  rescanPackDirectory: invoke("launcher:rescan-pack-directory"),
  restoreFailed: (filename) => ipcRenderer.invoke("launcher:restore-failed", filename),
  switchAccount: (userId) => ipcRenderer.invoke("launcher:switch-account", userId),
  useLibraryPack: (packId) => ipcRenderer.invoke("launcher:use-library-pack", packId),
  submitAll: invoke("launcher:submit-all"),
  syncPlugin: invoke("launcher:sync-plugin"),
});
