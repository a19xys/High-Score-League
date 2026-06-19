const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => () => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld("hslLauncher", {
  diagnose: invoke("launcher:diagnose"),
  getState: invoke("launcher:get-state"),
  logout: invoke("launcher:logout"),
  playCompetition: invoke("launcher:play-competition"),
  practice: invoke("launcher:practice"),
  submitAll: invoke("launcher:submit-all"),
  syncPlugin: invoke("launcher:sync-plugin"),
});
