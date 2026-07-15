const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, shell } = require("electron");
const service = require("./launcher-service");
const { createConnectivityService, isStableConnected } = require("../src/connectivity-service");
const { createRankingCapabilitiesService, safeRankingUrl } = require("../src/ranking-capabilities-service");
const { classifyMembershipConnectivitySignal } = require("../src/remote-connectivity-signals");

let mainWindow = null;
let connectivity = null;
let rankingCapabilities = null;
let activeRankingWeekId = null;
let removeConnectivityListener = null;
let removeRankingListener = null;
let previousReachability = "unknown";
let activeUserId = null;
let lastAutoSubmitKey = null;
let autoSubmitChain = Promise.resolve();
const CONNECTIVITY_REFRESH_REASONS = new Set([
  "manual",
  "connection-change",
  "renderer-offline",
  "renderer-online",
]);

function handlePowerSuspend() {
  connectivity?.setActivity("suspended", "suspend");
}

function handlePowerResume() {
  connectivity?.setActivity("active", "resume");
  connectivity?.signalPossibleRecovery("resume").catch(() => {});
}

function sendRendererEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function schedulePendingAutoSubmit(trigger) {
  const connection = connectivity?.getState();
  if (connection?.reachability !== "connected" || !activeUserId) return;
  const connectedGeneration = connection.reachabilityGeneration;
  const scheduledUserId = activeUserId;
  const key = `${connectedGeneration}:${scheduledUserId}`;
  if (key === lastAutoSubmitKey) return;
  lastAutoSubmitKey = key;
  autoSubmitChain = autoSubmitChain.catch(() => {}).then(async () => {
    const current = connectivity?.getState();
    if (current?.reachability !== "connected" || current.reachabilityGeneration !== connectedGeneration ||
        activeUserId !== scheduledUserId) return;
    const result = await service.runPendingAutoSubmit({
      connectedGeneration,
      shouldContinue: () => {
        const latest = connectivity?.getState();
        return latest?.reachability === "connected" &&
          latest.reachabilityGeneration === connectedGeneration && activeUserId === scheduledUserId;
      },
      trigger,
    });
    if (result?.transportFailure) connectivity?.signalOffline("auto-submit-transport", "transport");
    if (activeUserId === scheduledUserId) {
      const state = await service.getLauncherState({ deferRemoteMembership: true });
      sendRendererEvent("launcher:state", { autoSubmit: result, state });
    }
  });
}

function syncRemoteContext(state) {
  if (!state || !connectivity || !rankingCapabilities) return state;
  const webBaseUrl = state.bridge?.webBaseUrl || null;
  const nextUserId = state.session?.hasSession ? state.session.userId || null : null;
  if (nextUserId !== activeUserId) {
    service.invalidatePendingAutoSubmit("account-change");
    activeUserId = nextUserId;
    lastAutoSubmitKey = null;
    schedulePendingAutoSubmit("account-change");
  }
  activeRankingWeekId = state.game?.weekId || null;
  connectivity.setWebBaseUrl(webBaseUrl).catch(() => {});
  rankingCapabilities.updateContext({
    packs: state.library?.packs || [],
    webBaseUrl,
  });

  if (isStableConnected(connectivity.getState())) {
    rankingCapabilities.refresh("launcher-state").catch(() => {});
  }

  const membership = state.membership;
  const membershipSignal = classifyMembershipConnectivitySignal(membership);

  if (membershipSignal === "reachable") {
    connectivity.markReachable("membership-response");
  } else if (membershipSignal === "transport-failure") {
    connectivity.signalOffline("membership-transport", "transport");
  }

  return state;
}

async function withRemoteContext(promise) {
  const value = await promise;
  syncRemoteContext(value?.state || value);
  return value;
}

function initializeRemoteServices() {
  const bootstrap = service.getRemoteBootstrapState();
  connectivity = createConnectivityService({
    fetchImpl: (url, init) => net.fetch(url, init),
    netIsOnline: () => net.isOnline(),
    webBaseUrl: bootstrap.webBaseUrl,
  });
  rankingCapabilities = createRankingCapabilitiesService({
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    onReachable: (source) => connectivity.markReachable(source),
    onTransportFailure: (source) => connectivity.signalOffline(source, "transport"),
  });
  service.setRemoteDiagnosticsProvider(() => ({
    autoSubmit: service.getPendingAutoSubmitDiagnostics(),
    connectivity: connectivity.getDiagnostics(),
    ranking: rankingCapabilities.getDiagnostics(activeRankingWeekId),
  }));
  removeConnectivityListener = connectivity.subscribe((state) => {
    sendRendererEvent("launcher:connectivity-state", state);

    const becameConnected = state.reachability === "connected" && previousReachability !== "connected";
    previousReachability = state.reachability;
    if (isStableConnected(state)) {
      rankingCapabilities.refresh("connectivity-restored").catch(() => {});
      if (becameConnected) schedulePendingAutoSubmit(state.source === "startup" ? "startup" : "connectivity-restored");
    } else {
      sendRendererEvent("launcher:ranking-capabilities-state", rankingCapabilities.getState());
    }
  });
  removeRankingListener = rankingCapabilities.subscribe((state) => {
    sendRendererEvent("launcher:ranking-capabilities-state", state);
  });
}

function stopRemoteServices() {
  service.invalidatePendingAutoSubmit("shutdown");
  removeConnectivityListener?.();
  removeRankingListener?.();
  removeConnectivityListener = null;
  removeRankingListener = null;
  rankingCapabilities?.stop();
  connectivity?.stop();
  service.setRemoteDiagnosticsProvider(null);
}

async function prepareRemoteAction(source) {
  if (connectivity.getState().reachability !== "connected") {
    return connectivity.getState();
  }

  await connectivity.refresh(source, {
    maxAgeMs: connectivity.config.focusStaleMs,
    phase: "background",
  });

  return connectivity.getState();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1180,
    minHeight: 620,
    backgroundColor: "#0f172a",
    show: false,
    title: "High Score League Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("focus", () => {
    connectivity?.setActivity("active", "focus");
    connectivity?.refresh("focus", {
      maxAgeMs: connectivity.config.focusStaleMs,
      phase: "background",
    }).catch(() => {});
  });

  mainWindow.on("blur", () => {
    connectivity?.setActivity("background", "blur");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendBusyPhase(event, label) {
  event?.sender?.send("launcher:busy-phase", { label });
}

async function showImportZipDialog(event) {
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

  sendBusyPhase(event, "Importando pack");
  return service.importPackFromZipForGui(result.filePaths[0]);
}

async function showImportFolderDialog(event) {
  const result = await dialog.showOpenDialog(mainWindow, {
    buttonLabel: "Importar carpeta",
    message: "Elige la carpeta del pack o una carpeta con un unico pack dentro",
    properties: ["openDirectory"],
    title: "Importar pack desde carpeta",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return service.cancelImportPack();
  }

  sendBusyPhase(event, "Importando pack");
  return service.importPackFromFolderForGui(result.filePaths[0]);
}

function registerIpc() {
  ipcMain.handle("launcher:get-state", () => withRemoteContext(service.getLauncherState()));
  ipcMain.handle("launcher:get-connectivity-state", () => connectivity.getState());
  ipcMain.handle("launcher:request-connectivity-refresh", (_event, reason) => {
    const safeReason = CONNECTIVITY_REFRESH_REASONS.has(reason) ? reason : "manual";
    if (safeReason === "renderer-offline") {
      return connectivity.signalOffline(safeReason, "system-offline");
    }
    if (["renderer-online", "connection-change"].includes(safeReason)) {
      return connectivity.signalPossibleRecovery(safeReason);
    }
    return connectivity.refresh(safeReason, { force: true, phase: "manual" });
  });
  ipcMain.handle("launcher:get-ranking-capabilities-state", () => rankingCapabilities.getState());
  ipcMain.handle("launcher:request-ranking-capabilities-refresh", () => rankingCapabilities.refresh("renderer-request"));
  ipcMain.handle("launcher:get-auth-state", () => service.getAuthStateForGui());
  ipcMain.handle("launcher:login", async (_event, credentials) => {
    service.invalidatePendingAutoSubmit("login");
    await prepareRemoteAction("login");
    return withRemoteContext(service.loginWithPassword(credentials));
  });
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

    return withRemoteContext(service.openPackDirectory(result.filePaths[0]));
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

    return withRemoteContext(service.choosePackDirectoryFromGui(result.filePaths[0]));
  });
  ipcMain.handle("launcher:use-suggested-pack-directory", (_event, directoryPath) => (
    withRemoteContext(service.choosePackDirectoryFromGui(directoryPath))
  ));
  ipcMain.handle("launcher:import-pack-zip", (event) => withRemoteContext(showImportZipDialog(event)));
  ipcMain.handle("launcher:import-pack-folder", (event) => withRemoteContext(showImportFolderDialog(event)));
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
  ipcMain.handle("launcher:rescan-pack-directory", () => withRemoteContext(service.rescanPackDirectory()));
  ipcMain.handle("launcher:set-library-preferences", (_event, patch) => service.setLibraryPreferencesFromGui(patch));
  ipcMain.handle("launcher:toggle-library-favorite", (_event, packKey) => service.toggleLibraryFavoriteFromGui(packKey));
  ipcMain.handle("launcher:remove-known-account", (_event, userId) => {
    service.invalidatePendingAutoSubmit("remove-account");
    return withRemoteContext(service.removeKnownAccountFromGui(userId));
  });
  ipcMain.handle("launcher:switch-account", (_event, userId) => {
    service.invalidatePendingAutoSubmit("switch-account");
    return withRemoteContext(service.switchKnownAccountFromGui(userId));
  });
  ipcMain.handle("launcher:use-library-pack", (_event, packId) => withRemoteContext(service.activateLibraryPack(packId, {
    deferRemoteMembership: true,
  })));
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
  ipcMain.handle("launcher:open-ranking", async () => {
    const state = await service.getLauncherState();
    syncRemoteContext(state);
    const weekId = state.game?.weekId || null;
    const webBaseUrl = state.bridge?.webBaseUrl || null;

    if (!weekId) {
      return {
        action: "open-ranking",
        lines: ["Este pack no tiene un ranking configurado."],
        ok: false,
        summary: "Este pack no tiene un ranking configurado.",
        state,
      };
    }

    if (!isStableConnected(connectivity.getState())) {
      const summary = connectivity.getState().displayStatus === "offline"
        ? "Necesitas conexion para abrir el ranking."
        : "Comprobando conexion con High Score League.";
      return { action: "open-ranking", lines: [summary], ok: false, summary, state };
    }

    const connection = await connectivity.refresh("ranking-click", {
      maxAgeMs: connectivity.config.focusStaleMs,
      phase: "background",
    });

    if (!isStableConnected(connection)) {
      const summary = "Necesitas conexion para abrir el ranking.";
      return { action: "open-ranking", lines: [summary], ok: false, summary, state };
    }

    const capability = await rankingCapabilities.ensureCapability(weekId);

    const safeUrl = safeRankingUrl(capability.url, webBaseUrl);
    const contextStillMatches = activeRankingWeekId === weekId;

    if (!isStableConnected(connectivity.getState()) || !contextStillMatches ||
        capability.weekId !== weekId || capability.status !== "available" || !safeUrl) {
      const summary = capability.status === "unavailable"
        ? "El ranking todavia no esta disponible."
        : "No se pudo comprobar el ranking.";
      return { action: "open-ranking", lines: [summary], ok: false, summary, state };
    }

    await shell.openExternal(safeUrl);
    return {
      action: "open-ranking",
      lines: ["Ranking abierto en High Score League."],
      ok: true,
      summary: "Ranking abierto en la web.",
      state,
    };
  });
  ipcMain.handle("launcher:check-membership", async () => {
    await prepareRemoteAction("membership");
    return withRemoteContext(service.recheckSeasonMembership());
  });
  ipcMain.handle("launcher:diagnose", () => service.runDiagnose());
  ipcMain.handle("launcher:play-competition", () => service.playCompetition());
  ipcMain.handle("launcher:practice", () => service.playPractice());
  ipcMain.handle("launcher:submit-all", async () => {
    await prepareRemoteAction("submit");
    return withRemoteContext(service.submitAllPending());
  });
  ipcMain.handle("launcher:restore-failed", (_event, filename) => service.restoreFailedSubmission(filename));
  ipcMain.handle("launcher:sync-plugin", () => service.syncPlugin());
  ipcMain.handle("launcher:logout", () => {
    service.invalidatePendingAutoSubmit("logout");
    return withRemoteContext(service.logoutSession());
  });
}

app.whenReady().then(() => {
  initializeRemoteServices();
  registerIpc();
  connectivity.start("startup").catch(() => {});
  createMainWindow();
  powerMonitor.on("suspend", handlePowerSuspend);
  powerMonitor.on("resume", handlePowerResume);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  powerMonitor.removeListener("suspend", handlePowerSuspend);
  powerMonitor.removeListener("resume", handlePowerResume);
  stopRemoteServices();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
