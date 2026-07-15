const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, safeStorage, shell } = require("electron");
const service = require("./launcher-service");
const { createConnectivityService, isStableConnected } = require("../src/connectivity-service");
const { createRankingCapabilitiesService, safeRankingUrl } = require("../src/ranking-capabilities-service");
const { classifyMembershipConnectivitySignal } = require("../src/remote-connectivity-signals");
const { createNetworkTopologyMonitor } = require("../src/network-topology-monitor");
const { createPendingAutoSubmitCoordinator } = require("../src/pending-auto-submit-coordinator");
const { configureSessionProtection, getSessionStorageDiagnostics } = require("../src/secure-session-storage");

if (process.env.HSL_ELECTRON_VERBOSE_LOGGING === "1") {
  app.commandLine.appendSwitch("enable-logging");
  app.commandLine.appendSwitch("log-level", "0");
} else {
  app.commandLine.appendSwitch("log-level", "2");
}

let mainWindow = null;
let connectivity = null;
let rankingCapabilities = null;
let topologyMonitor = null;
let activeRankingWeekId = null;
let removeConnectivityListener = null;
let removeRankingListener = null;
let previousReachability = "unknown";
let activeUserId = null;
let pendingAutoSubmitCoordinator = null;
let connectivityRendererTiming = { appliedAt: null, emittedAt: null, receivedAt: null };
let rankingRendererTiming = { appliedAt: null, receivedAt: null, stateSequence: 0 };
let sessionMaintenanceTimer = null;
const CONNECTIVITY_REFRESH_REASONS = new Set([
  "manual",
  "connection-change",
  "renderer-offline",
  "renderer-online",
]);

function handlePowerSuspend() {
  topologyMonitor?.stop();
  connectivity?.setActivity("suspended", "suspend");
}

function handlePowerResume() {
  connectivity?.setActivity("active", "resume");
  topologyMonitor?.start();
  connectivity?.signalPossibleRecovery("resume").catch(() => {});
}

function sendRendererEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function schedulePendingAutoSubmit(trigger) {
  pendingAutoSubmitCoordinator?.request(trigger).catch(() => {});
}

function syncRemoteContext(state) {
  if (!state || !connectivity || !rankingCapabilities) return state;
  const webBaseUrl = state.bridge?.webBaseUrl || null;
  const nextUserId = state.session?.hasSession ? state.session.userId || null : null;
  const accountChanged = nextUserId !== activeUserId;
  if (accountChanged) {
    service.invalidatePendingAutoSubmit("account-change");
    pendingAutoSubmitCoordinator?.invalidate("account-change");
    activeUserId = nextUserId;
  }
  activeRankingWeekId = state.game?.weekId || null;
  connectivity.setWebBaseUrl(webBaseUrl).catch(() => {});
  rankingCapabilities.updateContext({
    activeInstanceKey: state.selection?.activeInstanceKey || null,
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

  schedulePendingAutoSubmit(accountChanged ? "account-change" : "state-ready");

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
  topologyMonitor = createNetworkTopologyMonitor({
    onChange(change) {
      if (change.snapshot.externalAddressCount === 0 && !net.isOnline()) {
        connectivity.signalOffline("topology-change", "system-offline");
        return;
      }
      connectivity.refresh("topology-change", {
        detectedAt: change.detectedAt,
        force: true,
        phase: "retry",
        supersede: true,
      }).catch(() => {});
    },
  });
  pendingAutoSubmitCoordinator = createPendingAutoSubmitCoordinator({
    inspect: () => service.getPendingAutoSubmitContexts({
      activeUserId,
      connection: connectivity.getState(),
    }),
    async onResult(result, context) {
      if (result?.transportFailure) connectivity.signalOffline("auto-submit-transport", "transport");
      const state = await service.getLauncherState({ deferRemoteMembership: true });
      sendRendererEvent("launcher:state", { autoSubmit: result, state });
    },
    run: (context) => service.runPendingAutoSubmitForAccounts({
      accountContexts: context.accountContexts,
      connectedGeneration: context.connection.reachabilityGeneration,
      shouldContinue: () => {
        const latest = connectivity.getState();
        return latest.reachability === "connected" &&
          latest.reachabilityGeneration === context.connection.reachabilityGeneration;
      },
      trigger: context.trigger,
    }),
  });
  service.setRemoteDiagnosticsProvider(() => ({
    autoSubmit: {
      ...service.getPendingAutoSubmitDiagnostics(),
      coordinator: pendingAutoSubmitCoordinator.getDiagnostics(),
    },
    sessions: service.getAccountSessionDiagnostics(),
    sessionStorage: getSessionStorageDiagnostics(),
    connectivity: {
      ...connectivity.getDiagnostics(),
      renderer: connectivityRendererTiming,
      topology: topologyMonitor.getDiagnostics(),
      window: {
        focused: mainWindow?.isFocused?.() || false,
        minimized: mainWindow?.isMinimized?.() || false,
      },
    },
    ranking: {
      ...rankingCapabilities.getDiagnostics(activeRankingWeekId),
      renderer: rankingRendererTiming,
    },
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

function initializeSecureSessionStorage() {
  if (!safeStorage.isEncryptionAvailable()) {
    configureSessionProtection(null);
    return;
  }
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend?.() || "unknown" : process.platform;
  const degraded = backend === "basic_text";
  configureSessionProtection({
    degraded,
    encryptionAvailable: !degraded,
    provider: `electron-${backend}`,
    decryptString(value) {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
    encryptString(value) {
      return safeStorage.encryptString(value).toString("base64");
    },
  });
}

function stopRemoteServices() {
  service.invalidatePendingAutoSubmit("shutdown");
  pendingAutoSubmitCoordinator?.invalidate("shutdown");
  removeConnectivityListener?.();
  removeRankingListener?.();
  removeConnectivityListener = null;
  removeRankingListener = null;
  rankingCapabilities?.stop();
  topologyMonitor?.stop();
  if (sessionMaintenanceTimer !== null) clearInterval(sessionMaintenanceTimer);
  sessionMaintenanceTimer = null;
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
  ipcMain.on("launcher:connectivity-applied", (_event, timing) => {
    connectivityRendererTiming = {
      appliedAt: timing?.appliedAt || null,
      emittedAt: timing?.emittedAt || null,
      receivedAt: timing?.receivedAt || null,
    };
  });
  ipcMain.on("launcher:ranking-applied", (_event, timing) => {
    rankingRendererTiming = {
      appliedAt: timing?.appliedAt || null,
      receivedAt: timing?.receivedAt || null,
      stateSequence: Number(timing?.stateSequence) || 0,
    };
  });
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
  ipcMain.handle("launcher:play-competition", () => withRemoteContext(service.playCompetition()));
  ipcMain.handle("launcher:practice", () => service.playPractice());
  ipcMain.handle("launcher:force-account-sync", async () => {
    pendingAutoSubmitCoordinator.invalidate("development-force");
    const result = await pendingAutoSubmitCoordinator.request("development-force");
    return {
      action: "force-account-sync",
      lines: [`Cuentas procesadas: ${Number(result?.processedAccounts) || 0}.`],
      ok: result?.status !== "deferred",
      state: await service.getLauncherState({ deferRemoteMembership: true }),
      summary: result?.status === "deferred" ? "La sincronizacion queda pendiente." : "Sincronizacion de cuentas completada.",
    };
  });
  ipcMain.handle("launcher:restore-failed", (_event, filename) => withRemoteContext(service.restoreFailedSubmission(filename)));
  ipcMain.handle("launcher:sync-plugin", () => service.syncPlugin());
  ipcMain.handle("launcher:logout", () => {
    service.invalidatePendingAutoSubmit("logout");
    return withRemoteContext(service.logoutSession());
  });
}

app.whenReady().then(async () => {
  initializeSecureSessionStorage();
  await service.migrateRememberedSessionsForGui().catch(() => []);
  initializeRemoteServices();
  registerIpc();
  connectivity.start("startup").catch(() => {});
  topologyMonitor.start();
  sessionMaintenanceTimer = setInterval(() => schedulePendingAutoSubmit("session-maintenance"), 60 * 1000);
  sessionMaintenanceTimer.unref?.();
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
