const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const service = require("./launcher-service");

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1180,
    minHeight: 620,
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

async function showImportZipDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    buttonLabel: "Importar ZIP",
    filters: [
      { name: "Packs comprimidos", extensions: ["zip"] },
    ],
    message: "Elige el ZIP del pack",
    properties: ["openFile"],
    title: "Importar pack ZIP",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return service.cancelImportPack();
  }

  return service.importPackFromZipForGui(result.filePaths[0]);
}

async function showImportFolderDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    buttonLabel: "Importar carpeta",
    message: "Elige la carpeta del pack o una carpeta con un unico pack dentro",
    properties: ["openDirectory"],
    title: "Importar pack desde carpeta",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return service.cancelImportPack();
  }

  return service.importPackFromFolderForGui(result.filePaths[0]);
}

function registerIpc() {
  ipcMain.handle("launcher:get-state", () => service.getLauncherState({ attemptAutoSync: true }));
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
  ipcMain.handle("launcher:choose-pack-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "Elegir directorio",
      message: "Elige la carpeta que contiene todos tus packs locales",
      properties: ["openDirectory"],
      title: "Directorio de packs de High Score League",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return service.cancelChoosePackDirectory();
    }

    return service.choosePackDirectoryFromGui(result.filePaths[0]);
  });
  ipcMain.handle("launcher:import-pack", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      buttons: ["Archivo ZIP", "Carpeta", "Cancelar"],
      cancelId: 2,
      defaultId: 0,
      message: "Que quieres importar?",
      noLink: true,
      title: "Importar pack",
      type: "question",
    });

    if (result.response === 0) {
      return showImportZipDialog();
    }

    if (result.response === 1) {
      return showImportFolderDialog();
    }

    return service.cancelImportPack();
  });
  ipcMain.handle("launcher:import-pack-zip", () => showImportZipDialog());
  ipcMain.handle("launcher:import-pack-folder", () => showImportFolderDialog());
  ipcMain.handle("launcher:open-pack-directory", () => service.openConfiguredPackDirectory({
    openPathImpl: (directoryPath) => shell.openPath(directoryPath),
  }));
  ipcMain.handle("launcher:choose-shared-mame-runtime", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "Elegir mame.exe",
      filters: [
        { name: "MAME", extensions: process.platform === "win32" ? ["exe"] : ["*"] },
      ],
      message: "Elige el ejecutable mame.exe del runtime compartido",
      properties: ["openFile"],
      title: "Runtime MAME compartido",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return service.cancelChooseSharedMameRuntime();
    }

    return service.chooseSharedMameRuntimeFromGui(result.filePaths[0]);
  });
  ipcMain.handle("launcher:open-shared-mame-runtime", () => service.openSharedMameRuntimeDirectory({
    openPathImpl: (directoryPath) => shell.openPath(directoryPath),
  }));
  ipcMain.handle("launcher:rescan-pack-directory", () => service.rescanPackDirectory());
  ipcMain.handle("launcher:set-library-preferences", (_event, patch) => service.setLibraryPreferencesFromGui(patch));
  ipcMain.handle("launcher:toggle-library-favorite", (_event, packKey) => service.toggleLibraryFavoriteFromGui(packKey));
  ipcMain.handle("launcher:remove-known-account", (_event, userId) => service.removeKnownAccountFromGui(userId));
  ipcMain.handle("launcher:switch-account", (_event, userId) => service.switchKnownAccountFromGui(userId));
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
  ipcMain.handle("launcher:open-manual", () => service.openPackManual({
    openExternalImpl: (url) => shell.openExternal(url),
    openPathImpl: (filePath) => shell.openPath(filePath),
  }));
  ipcMain.handle("launcher:open-ranking", () => service.openPackRanking({
    openExternalImpl: (url) => shell.openExternal(url),
    openPathImpl: (filePath) => shell.openPath(filePath),
  }));
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
