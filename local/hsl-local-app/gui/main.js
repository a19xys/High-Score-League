const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, safeStorage, shell } = require("electron");
const service = require("./launcher-service");
const { createConnectivityService, isCommittedConnected } = require("../src/connectivity-service");
const { createRankingCapabilitiesService, safeRankingUrl } = require("../src/ranking-capabilities-service");
const { createNetworkTopologyMonitor } = require("../src/network-topology-monitor");
const { createPendingAutoSubmitCoordinator } = require("../src/pending-auto-submit-coordinator");
const { createLauncherStateAuthority } = require("../src/launcher-state-authority");
const { safeMembershipJoinUrl } = require("../src/season-membership");
const { configureSessionProtection, getSessionStorageDiagnostics } = require("../src/secure-session-storage");
const { deriveDeveloperToolsEnabled, runDeveloperOnlyOperation } = require("../src/developer-tools");
const { deriveRemoteAvailability } = require("./shared/remote-availability");
const {
  createSecureWebPreferences,
  getRendererSecuritySummary,
  installRendererSecurity,
} = require("./security-policy");
const { installSingleInstancePolicy } = require("./single-instance");

if (process.env.HSL_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.HSL_USER_DATA_DIR));

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
let lastCommittedAt = null;
let activeUserId = null;
let pendingAutoSubmitCoordinator = null;
const launcherStateAuthority = createLauncherStateAuthority();
let connectivityRendererTiming = { appliedAt: null, emittedAt: null, receivedAt: null };
let rankingRendererTiming = { appliedAt: null, receivedAt: null, stateSequence: 0 };
let sessionMaintenanceTimer = null;
let quitAfterSessionDrain = false;
let quitDrainPromise = null;
let suspendDrainPromise = null;
let productOperationsController = new AbortController();
const developerToolsEnabled = deriveDeveloperToolsEnabled({
  environment: process.env,
  isPackaged: app.isPackaged,
});
let trustedHslOrigin = null;
let trustedHslOriginSource = "none";
let remoteConfiguration = null;
let lastLibraryRemoteContext = {
  connectivityUnaffected: true,
  directoryClassification: null,
  libraryStatus: null,
  selection: null,
};
const CONNECTIVITY_REFRESH_REASONS = new Set([
  "manual",
  "connection-change",
  "renderer-offline",
  "renderer-online",
]);

function handlePowerSuspend() {
  productOperationsController.abort("suspend");
  service.cancelAccountSessionOperations(null, "suspend");
  service.cancelPendingAutoSubmit("suspend");
  pendingAutoSubmitCoordinator?.cancelCurrentRun("suspend");
  suspendDrainPromise = Promise.resolve(service.drainAccountSessionOperations?.({
    reason: "suspend",
    timeoutMs: 2000,
  })).catch(() => null);
  topologyMonitor?.stop();
  connectivity?.setActivity("suspended", "suspend");
}

function handlePowerResume() {
  suspendDrainPromise = null;
  productOperationsController = new AbortController();
  connectivity?.setActivity("active", "resume");
  topologyMonitor?.start();
  pendingAutoSubmitCoordinator?.resume("resume").catch(() => {});
  connectivity?.signalPossibleRecovery("resume").catch(() => {});
}

function requestConnectivityConfirmation(source) {
  if (!connectivity || productOperationsController.signal.aborted) return;
  connectivity.refresh(source, { force: true, phase: "background" }).catch(() => {});
}

function sendRendererEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function schedulePendingAutoSubmit(trigger) {
  pendingAutoSubmitCoordinator?.request(trigger).catch(() => {});
}

function syncRemoteContext(state, options = {}) {
  if (state) {
    state.developerToolsEnabled = developerToolsEnabled;
    state.remoteConfiguration = remoteConfiguration;
  }
  if (!state || !connectivity || !rankingCapabilities) return state;
  const nextUserId = state.session?.hasSession ? state.session.userId || null : null;
  const accountChanged = nextUserId !== activeUserId;
  if (accountChanged) {
    activeUserId = nextUserId;
  }
  activeRankingWeekId = state.game?.weekId || null;
  lastLibraryRemoteContext = {
    connectivityUnaffected: true,
    directoryClassification: state.library?.directory?.classification || state.library?.directory?.reason || null,
    libraryStatus: state.library?.status || null,
    selection: state.selection?.activeInstanceKey || null,
  };
  rankingCapabilities.updateContext({
    packs: state.library?.packs || [],
    webBaseUrl: trustedHslOrigin,
  });

  if (isCommittedConnected(connectivity.getState())) {
    rankingCapabilities.refresh("launcher-state").catch(() => {});
  }

  const membership = state.membership;
  if (["transport-failure", "timeout"].includes(membership?.remoteFailure)) {
    requestConnectivityConfirmation("membership-product-signal");
  }

  if (options.scheduleAutoSubmit !== false) {
    schedulePendingAutoSubmit(accountChanged ? "account-change" : "state-ready");
  }

  return state;
}

async function withRemoteContext(promise) {
  const value = await promise;
  syncRemoteContext(value?.state || value);
  return value;
}

function registerLauncherStateHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const revision = launcherStateAuthority.reserveRevision();
    return Promise.resolve(handler(event, ...args))
      .then((value) => launcherStateAuthority.publishResult(value, revision));
  });
}

function initializeRemoteServices() {
  const bootstrap = service.getRemoteBootstrapState();
  trustedHslOrigin = bootstrap.hslOrigin || null;
  trustedHslOriginSource = bootstrap.originSource || "none";
  remoteConfiguration = bootstrap.remoteConfiguration || null;
  connectivity = createConnectivityService({
    fetchImpl: (url, init) => net.fetch(url, init),
    netIsOnline: () => net.isOnline(),
    webBaseUrl: trustedHslOrigin,
  });
  service.setRemoteOperationSignalProvider(() => productOperationsController.signal);
  rankingCapabilities = createRankingCapabilitiesService({
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    onTransportFailure: () => requestConnectivityConfirmation("ranking-product-signal"),
  });
  topologyMonitor = createNetworkTopologyMonitor({
    onChange(change) {
      if (change.snapshot.externalAddressCount === 0 && !net.isOnline()) {
        connectivity.confirmSystemOffline("topology-change");
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
    autoScheduleSessionRetry: true,
    inspect: () => service.getPendingAutoSubmitContexts({
      activeUserId,
      connection: connectivity.getState(),
    }),
    async onResult(result, context) {
      if (result?.transportFailure) requestConnectivityConfirmation("auto-submit-product-signal");
      const state = await service.getLauncherState({ deferRemoteMembership: true });
      syncRemoteContext(state, { scheduleAutoSubmit: false });
      sendRendererEvent("launcher:state", {
        autoSubmit: result,
        state: launcherStateAuthority.publishSnapshot(
          state,
          result.launcherStateRevision || launcherStateAuthority.reserveRevision(),
        ),
      });
    },
    async run(context) {
      const launcherStateRevision = launcherStateAuthority.reserveRevision();
      const result = await service.runPendingAutoSubmitForAccounts({
        accountContexts: context.accountContexts,
        connectedGeneration: context.connection.reachabilityGeneration,
        shouldContinue: () => {
          const latest = connectivity.getState();
          return latest.reachability === "connected" &&
            latest.reachabilityGeneration === context.connection.reachabilityGeneration;
        },
        trigger: context.trigger,
      });
      return { ...result, launcherStateRevision };
    },
  });
  service.setRemoteDiagnosticsProvider(() => ({
    securityPolicy: getRendererSecuritySummary(),
    autoSubmit: {
      ...service.getPendingAutoSubmitDiagnostics(),
      coordinator: pendingAutoSubmitCoordinator.getDiagnostics(),
    },
    sessions: service.getAccountSessionDiagnostics(),
    sessionStorage: getSessionStorageDiagnostics(),
    connectivity: {
      ...connectivity.getDiagnostics(),
      committedReachability: connectivity.getState().reachability,
      lastCommittedAt,
      probePhase: connectivity.getState().probe?.phase || "idle",
      originSource: trustedHslOriginSource,
      remoteConfiguration,
      remoteAvailability: deriveRemoteAvailability(connectivity.getState()),
      remoteAvailabilityGeneration: deriveRemoteAvailability(connectivity.getState()).generation,
      trustedHslOrigin,
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
    libraryRemoteContext: { ...lastLibraryRemoteContext },
  }));
  removeConnectivityListener = connectivity.subscribe((state) => {
    const becameConnected = state.reachability === "connected" && previousReachability !== "connected";
    if (state.reachability !== previousReachability && ["connected", "offline"].includes(state.reachability)) {
      lastCommittedAt = state.emittedAt || state.checkedAt || new Date().toISOString();
    }
    previousReachability = state.reachability;
    rankingCapabilities.updateDeployment();
    sendRendererEvent("launcher:connectivity-state", state);
    if (isCommittedConnected(state)) {
      rankingCapabilities.refresh(becameConnected ? "connectivity-restored" : "connectivity-confirmed").catch(() => {});
      if (becameConnected) schedulePendingAutoSubmit(state.source === "startup" ? "startup" : "connectivity-restored");
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

async function stopRemoteServices() {
  productOperationsController.abort("shutdown");
  const sessionDrain = service.shutdownAccountSessions({ reason: "shutdown", timeoutMs: 3000 });
  service.cancelPendingAutoSubmit("shutdown");
  pendingAutoSubmitCoordinator?.cancelCurrentRun("shutdown");
  pendingAutoSubmitCoordinator?.shutdown("shutdown");
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
  service.setRemoteOperationSignalProvider(null);
  return sessionDrain;
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
  const rendererDocumentPath = path.join(__dirname, "renderer", "index.html");
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1180,
    minHeight: 620,
    backgroundColor: "#0f172a",
    show: false,
    title: "High Score League Launcher",
    webPreferences: createSecureWebPreferences({
      developerToolsEnabled,
      preload: path.join(__dirname, "preload.js"),
    }),
  });

  installRendererSecurity(mainWindow.webContents, {
    developerToolsEnabled,
    expectedDocumentUrl: pathToFileURL(rendererDocumentPath).href,
  });
  mainWindow.loadFile(rendererDocumentPath);

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
  registerLauncherStateHandler("launcher:get-state", () => withRemoteContext(service.getLauncherState()));
  ipcMain.handle("launcher:get-connectivity-state", () => connectivity.getState());
  ipcMain.on("launcher:connectivity-applied", (_event, timing) => {
    connectivityRendererTiming = {
      appliedAt: timing?.appliedAt || null,
      emittedAt: timing?.emittedAt || null,
      inconsistency: timing?.inconsistency || null,
      rankingEnabled: timing?.rankingEnabled === true,
      receivedAt: timing?.receivedAt || null,
      remoteAvailability: timing?.remoteAvailability || null,
      rendererStateRevision: Number(timing?.rendererStateRevision) || 0,
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
      if (!net.isOnline()) return connectivity.confirmSystemOffline(safeReason);
      return connectivity.refresh(safeReason, { force: true, phase: "background" });
    }
    if (["renderer-online", "connection-change"].includes(safeReason)) {
      return connectivity.signalPossibleRecovery(safeReason);
    }
    return connectivity.refresh(safeReason, { force: true, phase: "manual" });
  });
  ipcMain.handle("launcher:get-ranking-capabilities-state", () => rankingCapabilities.getState());
  registerLauncherStateHandler("launcher:request-ranking-capabilities-refresh", async () => {
    const guarded = await runDeveloperOnlyOperation(developerToolsEnabled, () => rankingCapabilities.forceRefresh());
    const state = syncRemoteContext(await service.getLauncherState({ deferRemoteMembership: true }));
    if (!guarded.allowed) {
      return {
        action: "force-ranking-refresh",
        lines: ["La comprobacion forzada de rankings solo esta disponible en desarrollo."],
        ok: false,
        state,
        summary: "Accion disponible solo en desarrollo.",
      };
    }
    const summary = rankingCapabilities.getDiagnostics(activeRankingWeekId);
    return {
      action: "force-ranking-refresh",
      lines: [
        `Disponibles: ${summary.available.length}.`,
        `No disponibles: ${summary.unavailable.length}.`,
        `Sin confirmar: ${summary.unknown.length}.`,
      ],
      ok: true,
      state,
      summary: "Comprobacion de rankings completada.",
    };
  });
  ipcMain.handle("launcher:get-auth-state", () => service.getAuthStateForGui());
  registerLauncherStateHandler("launcher:login", async (_event, credentials) => {
    service.invalidateInteractiveRemoteOperations("login");
    service.cancelPendingAutoSubmit("login");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("login");
    await prepareRemoteAction("login");
    return withRemoteContext(service.loginWithPassword(credentials));
  });
  registerLauncherStateHandler("launcher:open-pack", async () => {
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
  registerLauncherStateHandler("launcher:choose-pack-directory", async () => {
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
  registerLauncherStateHandler("launcher:use-suggested-pack-directory", (_event, directoryPath) => (
    withRemoteContext(service.choosePackDirectoryFromGui(directoryPath))
  ));
  registerLauncherStateHandler("launcher:import-pack-zip", (event) => withRemoteContext(showImportZipDialog(event)));
  registerLauncherStateHandler("launcher:import-pack-folder", (event) => withRemoteContext(showImportFolderDialog(event)));
  registerLauncherStateHandler("launcher:open-pack-directory", () => service.openConfiguredPackDirectory({
    openPathImpl: (directoryPath) => shell.openPath(directoryPath),
  }));
  registerLauncherStateHandler("launcher:choose-shared-mame-runtime", async () => {
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
  registerLauncherStateHandler("launcher:open-shared-mame-runtime", () => service.openSharedMameRuntimeDirectory({
    openPathImpl: (directoryPath) => shell.openPath(directoryPath),
  }));
  registerLauncherStateHandler("launcher:rescan-pack-directory", () => withRemoteContext(service.rescanPackDirectory()));
  registerLauncherStateHandler("launcher:set-library-preferences", (_event, patch) => service.setLibraryPreferencesFromGui(patch));
  registerLauncherStateHandler("launcher:toggle-library-favorite", (_event, packKey) => service.toggleLibraryFavoriteFromGui(packKey));
  registerLauncherStateHandler("launcher:remove-known-account", (_event, userId) => {
    service.cancelPendingAutoSubmit("remove-account");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("remove-account");
    return withRemoteContext(service.removeKnownAccountFromGui(userId));
  });
  registerLauncherStateHandler("launcher:switch-account", (_event, userId) => {
    service.invalidateInteractiveRemoteOperations("switch-account");
    return withRemoteContext(service.switchKnownAccountFromGui(userId, {
      connected: isCommittedConnected(connectivity?.getState()),
    }));
  });
  registerLauncherStateHandler("launcher:use-library-pack", (_event, packId) => {
    service.invalidateInteractiveRemoteOperations("account-change");
    return withRemoteContext(service.activateLibraryPack(packId, {
      deferRemoteMembership: true,
    }));
  });
  registerLauncherStateHandler("launcher:open-membership-url", async () => {
    const state = await service.getLauncherState();
    const url = safeMembershipJoinUrl(
      { webBaseUrl: trustedHslOrigin },
      state.membership?.joinUrl || trustedHslOrigin,
    );

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
  registerLauncherStateHandler("launcher:open-manual", () => service.openPackManual({
    openExternalImpl: (url) => shell.openExternal(url),
    openPathImpl: (filePath) => shell.openPath(filePath),
  }));
  registerLauncherStateHandler("launcher:open-ranking", async () => {
    const state = await service.getLauncherState();
    syncRemoteContext(state);
    const weekId = state.game?.weekId || null;
    const webBaseUrl = trustedHslOrigin;

    if (!weekId) {
      return {
        action: "open-ranking",
        lines: ["Este pack no tiene un ranking configurado."],
        ok: false,
        summary: "Este pack no tiene un ranking configurado.",
        state,
      };
    }

    if (!deriveRemoteAvailability(connectivity.getState()).available) {
      const summary = "Necesitas conexion para abrir el ranking.";
      return { action: "open-ranking", lines: [summary], ok: false, summary, state };
    }

    const capability = await rankingCapabilities.ensureCapability(weekId);

    const safeUrl = safeRankingUrl(capability.url, webBaseUrl);
    const contextStillMatches = activeRankingWeekId === weekId;

    if (!deriveRemoteAvailability(connectivity.getState()).available || !contextStillMatches ||
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
  registerLauncherStateHandler("launcher:check-membership", async () => {
    await prepareRemoteAction("membership");
    return withRemoteContext(service.recheckSeasonMembership());
  });
  registerLauncherStateHandler("launcher:diagnose", () => service.runDiagnose());
  registerLauncherStateHandler("launcher:play-competition", () => withRemoteContext(service.playCompetition()));
  registerLauncherStateHandler("launcher:practice", () => service.playPractice());
  registerLauncherStateHandler("launcher:force-account-sync", async () => {
    const guarded = await runDeveloperOnlyOperation(developerToolsEnabled, async () => {
      pendingAutoSubmitCoordinator.cancelCurrentRun("development-force");
      pendingAutoSubmitCoordinator.resetGuards("development-force");
      return pendingAutoSubmitCoordinator.request("development-force");
    });
    if (!guarded.allowed) {
      return {
        action: "force-account-sync",
        lines: ["La sincronizacion forzada de cuentas solo esta disponible en desarrollo."],
        ok: false,
        state: syncRemoteContext(await service.getLauncherState({ deferRemoteMembership: true })),
        summary: "Accion disponible solo en desarrollo.",
      };
    }
    const result = guarded.value;
    return {
      action: "force-account-sync",
      lines: [`Cuentas procesadas: ${Number(result?.processedAccounts) || 0}.`],
      ok: result?.status !== "deferred",
      state: syncRemoteContext(await service.getLauncherState({ deferRemoteMembership: true })),
      summary: result?.status === "deferred" ? "La sincronizacion queda pendiente." : "Sincronizacion de cuentas completada.",
    };
  });
  registerLauncherStateHandler("launcher:restore-failed", (_event, filename) => withRemoteContext(service.restoreFailedSubmission(filename)));
  registerLauncherStateHandler("launcher:sync-plugin", () => service.syncPlugin());
  registerLauncherStateHandler("launcher:logout", () => {
    service.cancelPendingAutoSubmit("logout");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("logout");
    return withRemoteContext(service.logoutSession());
  });
}

const hasSingleInstanceLock = installSingleInstancePolicy(app, () => mainWindow);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
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

  app.on("before-quit", (event) => {
    if (quitAfterSessionDrain) return;
    event.preventDefault();
    if (quitDrainPromise) return;
    powerMonitor.removeListener("suspend", handlePowerSuspend);
    powerMonitor.removeListener("resume", handlePowerResume);
    quitDrainPromise = Promise.resolve(stopRemoteServices())
      .catch(() => null)
      .finally(() => {
        quitAfterSessionDrain = true;
        app.quit();
      });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
