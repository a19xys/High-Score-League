const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => () => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld("hslLauncher", {
  diagnose: invoke("launcher:diagnose"),
  getAuthState: invoke("launcher:get-auth-state"),
  getState: invoke("launcher:get-state"),
  login: (email, password) => ipcRenderer.invoke("launcher:login", { email, password }),
  logout: invoke("launcher:logout"),
  openPack: invoke("launcher:open-pack"),
  playCompetition: invoke("launcher:play-competition"),
  practice: invoke("launcher:practice"),
  restoreFailed: (filename) => ipcRenderer.invoke("launcher:restore-failed", filename),
  submitAll: invoke("launcher:submit-all"),
  syncPlugin: invoke("launcher:sync-plugin"),
});
