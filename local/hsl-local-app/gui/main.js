const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const service = require("./launcher-service");

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0f172a",
    title: "High Score League Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("launcher:get-state", () => service.getLauncherState());
  ipcMain.handle("launcher:get-auth-state", () => service.getAuthStateForGui());
  ipcMain.handle("launcher:login", (_event, credentials) => service.loginWithPassword(credentials));
  ipcMain.handle("launcher:open-pack", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "Abrir pack",
      message: "Elige la carpeta raíz del pack",
      properties: ["openDirectory"],
      title: "Abrir pack de High Score League",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return service.cancelOpenPack();
    }

    return service.openPackDirectory(result.filePaths[0]);
  });
  ipcMain.handle("launcher:diagnose", () => service.runDiagnose());
  ipcMain.handle("launcher:play-competition", () => service.playCompetition());
  ipcMain.handle("launcher:practice", () => service.playPractice());
  ipcMain.handle("launcher:submit-all", () => service.submitAllPending());
  ipcMain.handle("launcher:restore-failed", (_event, filename) => service.restoreFailedSubmission(filename));
  ipcMain.handle("launcher:sync-plugin", () => service.syncPlugin());
  ipcMain.handle("launcher:logout", () => service.logoutSession());
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
