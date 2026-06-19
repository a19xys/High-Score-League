const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
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
  ipcMain.handle("launcher:add-library-location", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "Añadir ubicación",
      message: "Elige una carpeta que contenga packs descomprimidos",
      properties: ["openDirectory"],
      title: "Añadir ubicación de biblioteca",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return service.cancelAddLibraryLocation();
    }

    return service.addLibraryLocationFromGui(result.filePaths[0]);
  });
  ipcMain.handle("launcher:remove-library-location", (_event, locationId) => service.removeLibraryLocationFromGui(locationId));
  ipcMain.handle("launcher:use-library-pack", (_event, packId) => service.activateLibraryPack(packId));
  ipcMain.handle("launcher:open-membership-url", async () => {
    const state = await service.getLauncherState();
    const url = state.membership?.joinUrl || state.bridge?.webBaseUrl;

    if (!url || !/^https?:\/\//i.test(url)) {
      return {
        action: "open-membership-url",
        lines: ["No hay una URL web valida para abrir."],
        ok: false,
        summary: "No hay una URL web valida para abrir.",
        state,
      };
    }

    await shell.openExternal(url);

    return {
      action: "open-membership-url",
      lines: [`Web abierta: ${url}`],
      ok: true,
      summary: "Web abierta en el navegador.",
      state,
    };
  });
  ipcMain.handle("launcher:check-membership", () => service.recheckSeasonMembership());
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
