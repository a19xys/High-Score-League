const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, powerMonitor, safeStorage, shell } = require("electron");
const service = require("./launcher-service");
const { applyLibraryLocationCandidate, showLibraryLocationDialog } = require("./library-location-dialog");
const { createConnectivityService, isCommittedConnected } = require("../src/connectivity-service");
const { createRankingCapabilitiesService, safeRankingUrl } = require("../src/ranking-capabilities-service");
const { createWeekCapabilitiesService } = require("../src/week-capabilities-service");
const { createNetworkTopologyMonitor } = require("../src/network-topology-monitor");
const { createPresenceService } = require("../src/presence-service");
const { createPendingAutoSubmitCoordinator } = require("../src/pending-auto-submit-coordinator");
const { createMembershipStartupCoordinator, membershipResolutionContext } = require("../src/membership-startup-coordinator");
const {
  membershipResolutionBlocksCompetition,
  runCompetitionPlayPreflight,
} = require("../src/competition-play-preflight");
const { runAccountMutationWithProfileRefresh } = require("../src/account-profile-orchestration");
const { createLauncherStateAuthority, isLauncherSnapshot } = require("../src/launcher-state-authority");
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
const {
  createThemeAuthority,
  themeBackgroundColor,
  themePersistenceErrorCode,
} = require("../src/theme-preferences");
const {
  normalizePreferenceScope,
  resolvePlayerPreferenceScope,
} = require("../src/preference-scope");
const packageMetadata = require("../package.json");
const { loadConfig } = require("../src/config");
const { getRepoPluginDir } = require("../src/dev-sync-plugin");
const { configureProductRuntime } = require("../src/product-runtime");

app.setName("High Score League");
if (process.env.HSL_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.HSL_USER_DATA_DIR));
configureProductRuntime({
  isPackaged: app.isPackaged,
  productConfig: packageMetadata.hslProduct || null,
  productName: app.getName(),
  resourcesPath: process.resourcesPath,
  userDataDir: app.getPath("userData"),
  version: app.getVersion(),
});

if (process.env.HSL_ELECTRON_VERBOSE_LOGGING === "1") {
  app.commandLine.appendSwitch("enable-logging");
  app.commandLine.appendSwitch("log-level", "0");
} else {
  app.commandLine.appendSwitch("log-level", "2");
}

let mainWindow = null;
let themeAuthority = null;
let localStartupPromise = Promise.resolve();
let connectivity = null;
let rankingCapabilities = null;
let weekCapabilities = null;
let topologyMonitor = null;
let presence = null;
let activeRankingWeekId = null;
let removeConnectivityListener = null;
let removeRankingListener = null;
let removeWeekCapabilitiesListener = null;
let weekAuthorityStartupPromise = Promise.resolve();
let previousReachability = "unknown";
let lastCommittedAt = null;
let forceWeekRefreshOnNextContext = false;

const NATIVE_TITLE_BAR_HEIGHT = 32;
const NATIVE_TITLE_BAR_OVERLAY_COLOR = "#00000000";
const NATIVE_ICON_PATHS = Object.freeze({
  linux: path.join(__dirname, "renderer", "assets", "native", "app-icon.png"),
  win32: path.join(__dirname, "renderer", "assets", "native", "app-icon.ico"),
});
let activeUserId = null;
let pendingAutoSubmitCoordinator = null;
let membershipStartupCoordinator = null;
let activeManualMembershipRun = null;
let manualMembershipRunSequence = 0;
const activeMembershipContextMutations = new Set();
let membershipContextMutationSequence = 0;
const launcherStateAuthority = createLauncherStateAuthority();
let connectivityRendererTiming = { appliedAt: null, emittedAt: null, receivedAt: null };
let rankingRendererTiming = { appliedAt: null, receivedAt: null, stateSequence: 0 };
let sessionMaintenanceTimer = null;
let quitAfterSessionDrain = false;
let quitDrainPromise = null;
let suspendDrainPromise = null;

function cancelManualMembershipRun(reason = "context-change") {
  manualMembershipRunSequence += 1;
  activeManualMembershipRun = null;
  service.invalidateInteractiveRemoteOperations(reason);
}

function invalidateMembershipContext(reason = "context-change") {
  membershipStartupCoordinator?.invalidate(reason);
  cancelManualMembershipRun(reason);
}

function membershipCoordinationPaused() {
  return activeManualMembershipRun !== null || activeMembershipContextMutations.size > 0;
}

async function withMembershipContextMutation(reason, operation) {
  invalidateMembershipContext(reason);
  if (["login", "logout", "remove-account", "switch-account"].includes(reason)) {
    service.cancelAccountProfileSync(reason === "remove-account" ? "remove-account" : reason);
  }
  service.cancelPendingAutoSubmit(reason);
  pendingAutoSubmitCoordinator?.cancelCurrentRun(reason);
  const runId = ++membershipContextMutationSequence;
  activeMembershipContextMutations.add(runId);
  try {
    return await operation();
  } finally {
    activeMembershipContextMutations.delete(runId);
  }
}

async function applyPackDirectoryCandidate(directoryPath) {
  return applyLibraryLocationCandidate({
    chooseCandidate: (candidatePath) => service.choosePackDirectoryFromGui(candidatePath, { includeState: false }),
    directoryPath,
    readAcceptedState: () => withRemoteContext(service.getLauncherState()),
    readStableState: () => service.getLauncherState({ deferRemoteMembership: true }),
    runAcceptedMutation: (operation) => withMembershipContextMutation("pack-directory-change", operation),
  });
}

async function withAccountProfileRefreshAfterMutation(reason, operation) {
  return runAccountMutationWithProfileRefresh({
    operation: () => withMembershipContextMutation(reason, operation),
    requestProfileSync: service.requestAccountProfileSync,
    trigger: reason,
  });
}
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
const STARTUP_MILESTONES = new Set([
  "assets-resolved",
  "document-ready",
  "first-snapshot",
  "interactive",
  "selection-stable",
  "shell-mounted",
  "startup-degraded",
  "startup-ready",
  "theme-resolved",
  "window-created",
  "window-shown",
]);
const startupStartedAt = Date.now();
const startupTimings = {};

function recordStartupMilestone(name, details = {}) {
  if (!STARTUP_MILESTONES.has(name) || startupTimings[name]) return;
  startupTimings[name] = {
    elapsedMs: Math.max(0, Date.now() - startupStartedAt),
    status: ["ready", "degraded", "fallback", "error", "timeout"].includes(details.status)
      ? details.status
      : null,
  };
}

function readSystemTheme() {
  return typeof nativeTheme.shouldUseDarkColors === "boolean"
    ? nativeTheme.shouldUseDarkColors ? "dark" : "light"
    : null;
}

function publicThemeState(state = themeAuthority?.getState()) {
  return {
    effectiveTheme: state?.effectiveTheme === "light" ? "light" : "dark",
    lastSystemTheme: ["light", "dark"].includes(state?.lastSystemTheme) ? state.lastSystemTheme : null,
    manualTheme: ["light", "dark"].includes(state?.manualTheme) ? state.manualTheme : null,
    mode: state?.mode === "manual" ? "manual" : "system",
    playerKey: state?.scope === "player" ? state.playerKey || null : null,
    schemaVersion: Number(state?.schemaVersion) || 1,
    scope: state?.scope === "player" ? "player" : "global",
    scopeKey: state?.scopeKey || "global",
    warnings: Array.isArray(state?.warnings) ? state.warnings : [],
  };
}

function nativeTitleBarOverlay(theme) {
  const dark = theme !== "light";
  return {
    color: NATIVE_TITLE_BAR_OVERLAY_COLOR,
    height: NATIVE_TITLE_BAR_HEIGHT,
    symbolColor: dark ? "#f8fafc" : "#0f172a",
  };
}

function nativeWindowChromeOptions(platform, theme) {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset" };
  }

  return {
    icon: NATIVE_ICON_PATHS[platform] || NATIVE_ICON_PATHS.linux,
    titleBarOverlay: nativeTitleBarOverlay(theme),
    titleBarStyle: "hidden",
  };
}

function applyNativeThemeSource(theme) {
  if (process.platform === "win32") {
    nativeTheme.themeSource = theme === "light" ? "light" : "dark";
  }
}

function applyNativeWindowTheme(window, theme) {
  applyNativeThemeSource(theme);
  if (!window || window.isDestroyed?.()) return;
  window.setBackgroundColor?.(themeBackgroundColor(theme));
  if (process.platform !== "darwin") {
    window.setTitleBarOverlay?.(nativeTitleBarOverlay(theme));
  }
}

function writePackagedSmokeReport(phase) {
  const reportPath = process.env.HSL_PACKAGED_SMOKE_FILE;
  if (!reportPath) return null;
  try {
    const config = loadConfig();
    const pluginSource = getRepoPluginDir(config.appDir);
    const report = {
      isPackaged: app.isPackaged,
      mame: {
        available: config.sharedMameRuntime?.available === true,
        path: config.sharedMameRuntime?.mameExecutablePath || null,
        source: config.sharedMameRuntime?.source || "missing",
        version: config.sharedMameRuntime?.version || null,
      },
      phase,
      pluginAvailable: fs.existsSync(path.join(pluginSource, "init.lua")),
      productConfigAvailable: Boolean(config.hslOrigin && config.supabaseUrl && config.supabasePublishableKey),
      productName: app.getName(),
      rendererReady: phase === "renderer-ready",
      resourcesPath: process.resourcesPath,
      version: app.getVersion(),
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    return report;
  } catch (error) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ error: error.message, phase }), "utf8");
    return null;
  }
}

function handlePowerSuspend() {
  productOperationsController.abort("suspend");
  service.pausePlayTime();
  service.cancelPlayTimeSync("suspend");
  presence?.setSuspended(true);
  service.cancelAccountProfileSync("suspend");
  cancelManualMembershipRun("suspend");
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
  service.resumePlayTime();
  presence?.setSuspended(false).catch(() => {});
  connectivity?.setActivity("active", "resume");
  if (!membershipCoordinationPaused()) membershipStartupCoordinator?.resume("resume");
  topologyMonitor?.start();
  if (!membershipCoordinationPaused()) pendingAutoSubmitCoordinator?.resume("resume").catch(() => {});
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

async function publishAccountProfileState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const revision = launcherStateAuthority.reserveRevision();
  const state = await service.getLauncherState({ deferRemoteMembership: true });
  if (!launcherStateAuthority.acceptEffects(revision)) return;
  const syncedState = syncRemoteContext(state, {
    coordinateMembership: false,
    refreshWeekCapabilities: false,
    scheduleAutoSubmit: false,
  });
  const preferenceState = await enrichPreferenceState(syncedState, {
    isCurrent: () => launcherStateAuthority.isEffectRevisionCurrent(revision),
  });
  if (!preferenceState) return;
  if (!launcherStateAuthority.isEffectRevisionCurrent(revision)) return;
  sendRendererEvent("launcher:state", {
    accountProfiles: true,
    state: launcherStateAuthority.publishSnapshot(preferenceState, revision),
  });
}

async function publishWeekCapabilityState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const revision = launcherStateAuthority.reserveRevision();
  const state = await service.getLauncherState({ deferRemoteMembership: true });
  if (!launcherStateAuthority.acceptEffects(revision)) return;
  const syncedState = syncRemoteContext(state, {
    coordinateMembership: false,
    refreshWeekCapabilities: false,
    scheduleAutoSubmit: false,
  });
  const preferenceState = await enrichPreferenceState(syncedState, {
    isCurrent: () => launcherStateAuthority.isEffectRevisionCurrent(revision),
  });
  if (!preferenceState) return;
  if (!launcherStateAuthority.isEffectRevisionCurrent(revision)) return;
  sendRendererEvent("launcher:state", {
    competitionAuthority: true,
    state: launcherStateAuthority.publishSnapshot(preferenceState, revision),
  });
}

function schedulePendingAutoSubmit(trigger) {
  if (membershipCoordinationPaused()) return;
  pendingAutoSubmitCoordinator?.request(trigger).catch(() => {});
}

function syncRemoteContext(state, options = {}) {
  if (state) {
    state.developerToolsEnabled = developerToolsEnabled;
    state.remoteConfiguration = remoteConfiguration;
  }
  if (!state || !connectivity || !rankingCapabilities || !weekCapabilities) return state;
  const nextUserId = state.session?.hasSession ? state.session.userId || null : null;
  const accountChanged = nextUserId !== activeUserId;
  if (accountChanged) {
    activeUserId = nextUserId;
    presence?.setActiveUserId(nextUserId).catch(() => {});
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
  weekCapabilities.updateContext({
    packs: state.library?.packs || [],
    webBaseUrl: trustedHslOrigin,
  });
  state = service.applyCompetitionAuthorityState(state);

  if (isCommittedConnected(connectivity.getState())) {
    rankingCapabilities.refresh("launcher-state").catch(() => {});
    if (options.refreshWeekCapabilities !== false) {
      const forceWeekRefresh = forceWeekRefreshOnNextContext && (state.library?.packs || []).some((pack) => pack?.weekId);
      if (forceWeekRefresh) forceWeekRefreshOnNextContext = false;
      weekCapabilities.refresh("launcher-state", { force: forceWeekRefresh }).catch(() => {});
    }
    if (accountChanged) service.requestPlayTimeSync("account-change").catch(() => {});
  }

  const membership = state.membership;
  if (["transport-failure", "timeout"].includes(membership?.remoteFailure)) {
    requestConnectivityConfirmation("membership-product-signal");
  }

  if (options.scheduleAutoSubmit !== false && !membershipCoordinationPaused()) {
    schedulePendingAutoSubmit(accountChanged ? "account-change" : "state-ready");
  }

  if (options.coordinateMembership === false || membershipCoordinationPaused()) return state;
  const coordinated = membershipStartupCoordinator?.observeState(state, options.membershipTrigger || "launcher-state") || state;
  return service.applyCompetitionAuthorityState(coordinated);
}

async function withRemoteContext(promise) {
  return promise;
}

function coordinateMembershipResult(value, trigger, revision, options = {}) {
  const nestedState = isLauncherSnapshot(value?.state) ? value.state : null;
  const directState = nestedState ? null : isLauncherSnapshot(value) ? value : null;
  const sourceState = nestedState || directState;
  if (!sourceState) return value;
  const numericRevision = Number(revision);
  if (!launcherStateAuthority.acceptEffects(numericRevision)) return value;
  if (membershipCoordinationPaused()) return value;
  const state = syncRemoteContext(sourceState, {
    membershipTrigger: trigger,
    scheduleAutoSubmit: options.scheduleAutoSubmit,
  });
  return nestedState ? { ...value, state } : state;
}

async function enrichPreferenceState(sourceState, options = {}) {
  const preferenceScope = normalizePreferenceScope(sourceState.preferenceScope);
  const previousScopeKey = themeAuthority?.getScope?.().scopeKey || "global";
  const theme = await themeAuthority.switchScope(preferenceScope);
  if (typeof options.isCurrent === "function" && !options.isCurrent()) return null;
  const publicTheme = publicThemeState(theme);
  if (previousScopeKey !== preferenceScope.scopeKey) {
    applyNativeWindowTheme(mainWindow, publicTheme.effectiveTheme);
  }
  return {
    ...sourceState,
    preferenceScope,
    preferences: {
      scope: preferenceScope,
      theme: publicTheme,
    },
  };
}

async function coordinatePreferenceResult(value, revision) {
  const nestedState = isLauncherSnapshot(value?.state) ? value.state : null;
  const directState = nestedState ? null : isLauncherSnapshot(value) ? value : null;
  const sourceState = nestedState || directState;
  if (!sourceState || !launcherStateAuthority.isEffectRevisionCurrent(Number(revision))) return value;
  const state = await enrichPreferenceState(sourceState, {
    isCurrent: () => launcherStateAuthority.isEffectRevisionCurrent(Number(revision)),
  });
  if (!state) return value;
  if (!launcherStateAuthority.isEffectRevisionCurrent(Number(revision))) return value;
  return nestedState ? { ...value, state } : state;
}

function registerLauncherStateHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const revision = launcherStateAuthority.reserveRevision();
    return Promise.resolve(handler(event, ...args))
      .then((value) => coordinateMembershipResult(value, `ipc:${channel}`, revision))
      .then((value) => coordinatePreferenceResult(value, revision))
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
  service.configureAccountProfileSync({
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    onChanged: publishAccountProfileState,
  });
  service.configurePlayTimeSync({
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    resolveSessionResultImpl: (_config, options) => service.resolveCanonicalSessionForRemote(options),
  });
  presence = createPresenceService({
    configProvider: () => ({
      hslOrigin: trustedHslOrigin,
      userDataDir: app.getPath("userData"),
      webBaseUrl: trustedHslOrigin,
    }),
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    resolveSessionResultImpl: (_config, options) => service.resolveCanonicalSessionForRemote(options),
  });
  service.setPresenceLifecycleProvider((context) => presence?.createMameLifecycle(context));
  service.setPresenceAccountLifecycleProvider({
    beforeAccountChange: (reason) => presence?.clearCurrent(reason),
  });
  presence.start().catch(() => {});
  service.setRemoteOperationSignalProvider(() => productOperationsController.signal);
  rankingCapabilities = createRankingCapabilitiesService({
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    onTransportFailure: () => requestConnectivityConfirmation("ranking-product-signal"),
  });
  weekCapabilities = createWeekCapabilitiesService({
    fetchImpl: (url, init) => net.fetch(url, init),
    getConnectivityState: () => connectivity.getState(),
    onTransportFailure: () => requestConnectivityConfirmation("week-capabilities-product-signal"),
    userDataDir: app.getPath("userData"),
  });
  weekAuthorityStartupPromise = weekCapabilities.initialize();
  service.setCompetitionAuthorityProvider({
    getContext: () => ({
      connected: isCommittedConnected(connectivity.getState()),
      reachabilityGeneration: Number(connectivity.getState().reachabilityGeneration) || 0,
      ...weekCapabilities.getAuthorityContext(),
    }),
    getWeekCapability: (weekId) => weekCapabilities.getCapability(weekId),
    ensureFreshCapability: (weekId) => weekCapabilities.ensureFreshCapability(weekId, "play-preflight"),
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
  membershipStartupCoordinator = createMembershipStartupCoordinator({
    connectivityTimeoutMs: connectivity.config.healthTimeoutMs,
    execute: ({ signal }) => service.getLauncherState({ connected: true, signal }),
    getConnectivityState: () => connectivity.getState(),
    async publish(state, resolution) {
      if (!launcherStateAuthority.acceptEffects(resolution.revision)) return;
      const syncedState = syncRemoteContext(state, {
        coordinateMembership: false,
        membershipTrigger: resolution.phase,
      });
      const preferenceState = await enrichPreferenceState(syncedState, {
        isCurrent: () => launcherStateAuthority.isEffectRevisionCurrent(resolution.revision),
      });
      if (!preferenceState) return;
      if (!launcherStateAuthority.isEffectRevisionCurrent(resolution.revision)) return;
      sendRendererEvent("launcher:state", {
        membershipResolution: { phase: resolution.phase },
        state: launcherStateAuthority.publishSnapshot(preferenceState, resolution.revision),
      });
    },
    reserveRevision: () => launcherStateAuthority.reserveRevision(),
  });
  pendingAutoSubmitCoordinator = createPendingAutoSubmitCoordinator({
    autoScheduleSessionRetry: true,
    inspect: () => service.getPendingAutoSubmitContexts({
      activeUserId,
      connection: connectivity.getState(),
    }),
    async onResult(result, context) {
      if (membershipCoordinationPaused()) return;
      if (result?.transportFailure) requestConnectivityConfirmation("auto-submit-product-signal");
      const state = await service.getLauncherState({ deferRemoteMembership: true });
      if (membershipCoordinationPaused()) return;
      const revision = result.launcherStateRevision || launcherStateAuthority.reserveRevision();
      const coordinatedState = coordinateMembershipResult(
        state,
        `auto-submit:${context?.trigger || "result"}`,
        revision,
        { scheduleAutoSubmit: false },
      );
      if (!launcherStateAuthority.isEffectRevisionCurrent(revision)) return;
      const preferenceState = await enrichPreferenceState(coordinatedState, {
        isCurrent: () => launcherStateAuthority.isEffectRevisionCurrent(revision),
      });
      if (!preferenceState) return;
      if (!launcherStateAuthority.isEffectRevisionCurrent(revision)) return;
      sendRendererEvent("launcher:state", {
        autoSubmit: result,
        state: launcherStateAuthority.publishSnapshot(
          preferenceState,
          revision,
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
          return !membershipCoordinationPaused()
            && latest.reachability === "connected" &&
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
    accountProfiles: service.getAccountProfileSyncDiagnostics(),
    playTime: service.getPlayTimeDiagnostics(),
    presence: presence?.getDiagnostics() || { running: false },
    membershipResolution: membershipStartupCoordinator.getDiagnostics(),
    sessionStorage: getSessionStorageDiagnostics(),
    startup: { milestones: { ...startupTimings } },
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
    weekCapabilities: weekCapabilities.getDiagnostics(),
    libraryRemoteContext: { ...lastLibraryRemoteContext },
  }));
  removeConnectivityListener = connectivity.subscribe((state) => {
    const becameConnected = state.reachability === "connected" && previousReachability !== "connected";
    if (state.reachability !== previousReachability && ["connected", "offline"].includes(state.reachability)) {
      lastCommittedAt = state.emittedAt || state.checkedAt || new Date().toISOString();
    }
    previousReachability = state.reachability;
    rankingCapabilities.updateDeployment();
    weekCapabilities.updateDeployment();
    sendRendererEvent("launcher:connectivity-state", state);
    presence?.setOnline(isCommittedConnected(state), state.source || "connectivity-change").catch(() => {});
    if (state.reachability === "offline") service.cancelAccountProfileSync("external-abort");
    if (state.reachability === "offline") service.cancelPlayTimeSync("external-abort");
    if (activeManualMembershipRun && activeManualMembershipRun.connectionGeneration !== null && (
      state.reachability !== "connected"
      || Number(state.reachabilityGeneration) !== Number(activeManualMembershipRun.connectionGeneration)
    )) {
      cancelManualMembershipRun("manual-membership-connectivity-change");
    }
    if (!membershipCoordinationPaused()) {
      membershipStartupCoordinator?.updateConnectivity(
        state,
        becameConnected ? "connectivity-restored" : "connectivity-change",
      );
    }
    if (isCommittedConnected(state)) {
      const manual = state.probe?.phase === "manual" || state.source === "manual";
      const weekCount = Object.keys(weekCapabilities.getState().entries || {}).length;
      if (becameConnected && weekCount === 0) forceWeekRefreshOnNextContext = true;
      service.requestAccountProfileSync(
        becameConnected ? (state.source === "startup" ? "startup" : "connectivity-restored") : manual ? "manual-connectivity" : "connectivity-confirmed",
        { force: manual },
      );
      service.requestPlayTimeSync(
        becameConnected ? (state.source === "startup" ? "startup" : "connectivity-restored") : manual ? "manual-connectivity" : "connectivity-confirmed",
      ).catch(() => {});
      rankingCapabilities.refresh(becameConnected ? "connectivity-restored" : "connectivity-confirmed").catch(() => {});
      weekCapabilities.refresh(
        becameConnected ? "connectivity-restored" : "connectivity-confirmed",
        { force: becameConnected || manual },
      ).catch(() => {});
      if (becameConnected) schedulePendingAutoSubmit(state.source === "startup" ? "startup" : "connectivity-restored");
    }
  });
  removeRankingListener = rankingCapabilities.subscribe((state) => {
    sendRendererEvent("launcher:ranking-capabilities-state", state);
  });
  removeWeekCapabilitiesListener = weekCapabilities.subscribe(() => {
    publishWeekCapabilityState().catch(() => {});
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
  const playTimeDrain = service.shutdownPlayTime();
  const presenceDrain = presence?.shutdown() || Promise.resolve();
  service.shutdownAccountProfileSync();
  membershipStartupCoordinator?.shutdown("shutdown");
  cancelManualMembershipRun("shutdown");
  const sessionDrain = service.shutdownAccountSessions({ reason: "shutdown", timeoutMs: 3000 });
  service.cancelPendingAutoSubmit("shutdown");
  pendingAutoSubmitCoordinator?.cancelCurrentRun("shutdown");
  pendingAutoSubmitCoordinator?.shutdown("shutdown");
  removeConnectivityListener?.();
  removeRankingListener?.();
  removeWeekCapabilitiesListener?.();
  removeConnectivityListener = null;
  removeRankingListener = null;
  removeWeekCapabilitiesListener = null;
  rankingCapabilities?.stop();
  weekCapabilities?.stop();
  topologyMonitor?.stop();
  if (sessionMaintenanceTimer !== null) clearInterval(sessionMaintenanceTimer);
  sessionMaintenanceTimer = null;
  connectivity?.stop();
  service.setRemoteDiagnosticsProvider(null);
  service.setRemoteOperationSignalProvider(null);
  service.setCompetitionAuthorityProvider(null);
  service.setPresenceLifecycleProvider(null);
  service.setPresenceAccountLifecycleProvider(null);
  return Promise.allSettled([playTimeDrain, presenceDrain, sessionDrain]);
}

async function prepareRemoteAction(source, options = {}) {
  if (connectivity.getState().reachability !== "connected") {
    return connectivity.getState();
  }

  await connectivity.refresh(source, {
    force: options.force === true,
    maxAgeMs: options.force === true ? 0 : connectivity.config.focusStaleMs,
    phase: "background",
  });

  return connectivity.getState();
}

function createMainWindow() {
  const rendererDocumentPath = path.join(__dirname, "renderer", "index.html");
  const theme = publicThemeState();
  applyNativeThemeSource(theme.effectiveTheme);
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1200,
    minHeight: 620,
    backgroundColor: themeBackgroundColor(theme.effectiveTheme),
    show: false,
    title: "High Score League Launcher",
    ...nativeWindowChromeOptions(process.platform, theme.effectiveTheme),
    webPreferences: createSecureWebPreferences({
      additionalArguments: [
        `--hsl-startup-theme=${theme.effectiveTheme}`,
        `--hsl-legacy-theme-migration=${themeAuthority?.canMigrateRendererLegacyTheme() ? "1" : "0"}`,
        `--hsl-product-version=${app.getVersion()}`,
      ],
      developerToolsEnabled,
      preload: path.join(__dirname, "preload.js"),
    }),
  });

  installRendererSecurity(mainWindow.webContents, {
    developerToolsEnabled,
    expectedDocumentUrl: pathToFileURL(rendererDocumentPath).href,
  });
  recordStartupMilestone("window-created");
  mainWindow.webContents.once("dom-ready", () => recordStartupMilestone("document-ready"));
  mainWindow.webContents.once("dom-ready", () => {
    if (!process.env.HSL_PACKAGED_SMOKE_FILE) return;
    writePackagedSmokeReport("renderer-ready");
    setTimeout(() => app.quit(), 50).unref?.();
  });
  mainWindow.loadFile(rendererDocumentPath);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    recordStartupMilestone("window-shown");
  });

  mainWindow.on("focus", () => {
    connectivity?.setActivity("active", "focus");
    connectivity?.refresh("focus", {
      maxAgeMs: connectivity.config.focusStaleMs,
      phase: "background",
    }).catch(() => {});
    if (isCommittedConnected(connectivity?.getState?.() || {})) {
      weekCapabilities?.refresh("focus").catch(() => {});
    }
  });

  mainWindow.on("blur", () => {
    connectivity?.setActivity("background", "blur");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendBusyPhase(event, label, phase = null) {
  event?.sender?.send("launcher:busy-phase", { label, phase });
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
  return withMembershipContextMutation(
    "import-pack",
    () => service.importPackFromZipForGui(result.filePaths[0]),
  );
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
  return withMembershipContextMutation(
    "import-pack",
    () => service.importPackFromFolderForGui(result.filePaths[0]),
  );
}

function registerIpc() {
  registerLauncherStateHandler("launcher:get-state", () => withRemoteContext(service.getLauncherState({ deferRemoteMembership: true })));
  registerLauncherStateHandler("launcher:get-initial-state", async () => {
    await localStartupPromise;
    return withRemoteContext(service.getLauncherState({ deferRemoteMembership: true }));
  });
  ipcMain.on("launcher:resolve-theme-bootstrap", (event, legacyTheme) => {
    let state = themeAuthority?.getState();
    let legacyMigrationStatus = legacyTheme === "light" || legacyTheme === "dark" ? "ignored" : "not-needed";
    try {
      state = themeAuthority?.migrateRendererLegacyThemeSync(legacyTheme) || state;
      if (state?.source === "renderer-legacy-migrated") legacyMigrationStatus = "persisted";
    } catch (error) {
      legacyMigrationStatus = "failed";
      const publicState = publicThemeState(state);
      event.returnValue = {
        ...publicState,
        legacyMigrationStatus,
        persistenceError: themePersistenceErrorCode(error),
      };
      return;
    }
    const publicState = publicThemeState(state);
    applyNativeWindowTheme(mainWindow, publicState.effectiveTheme);
    event.returnValue = { ...publicState, legacyMigrationStatus };
  });
  ipcMain.handle("launcher:set-theme", async (_event, request) => {
    const theme = typeof request === "string" ? request : request?.theme;
    const scopeKey = typeof request === "object" ? request?.scopeKey : null;
    try {
      const state = await themeAuthority.setManualTheme(theme, scopeKey);
      const publicState = publicThemeState(state);
      if (publicState.scopeKey === themeAuthority.getScope().scopeKey) {
        applyNativeWindowTheme(mainWindow, publicState.effectiveTheme);
      }
      return { ...publicState, ok: true };
    } catch (error) {
      return {
        ...publicThemeState(),
        ok: false,
        persistenceError: themePersistenceErrorCode(error),
      };
    }
  });
  ipcMain.on("launcher:startup-milestone", (_event, milestone) => {
    const name = String(milestone?.name || "");
    recordStartupMilestone(name, { status: milestone?.status });
  });
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
    const state = await service.getLauncherState({ deferRemoteMembership: true });
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
  registerLauncherStateHandler("launcher:login", (_event, credentials) => withAccountProfileRefreshAfterMutation("login", async () => {
    service.cancelPendingAutoSubmit("login");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("login");
    await prepareRemoteAction("login");
    return withRemoteContext(service.loginWithPassword(credentials));
  }));
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

    return withMembershipContextMutation(
      "open-pack",
      () => withRemoteContext(service.openPackDirectory(result.filePaths[0])),
    );
  });
  registerLauncherStateHandler("launcher:choose-pack-directory", async () => {
    const result = await showLibraryLocationDialog({
      dialog,
      getSelectionContext: () => service.getLibraryLocationSelectionContext(),
      getSystemPath: (name) => app.getPath(name),
      parentWindow: mainWindow,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return service.cancelChoosePackDirectory();
    }

    return applyPackDirectoryCandidate(result.filePaths[0]);
  });
  registerLauncherStateHandler("launcher:detect-library-location", async (_event, candidatePath) => {
    if (typeof candidatePath !== "string" || !candidatePath.trim()) {
      return withMembershipContextMutation(
        "pack-rescan",
        () => withRemoteContext(service.rescanPackDirectory()),
      );
    }

    const detection = await service.detectLibraryLocationCandidate(candidatePath);
    if (!detection.ok || !detection.detectedRootPath) {
      return {
        ...detection,
        state: await service.getLauncherState({ deferRemoteMembership: true }),
      };
    }

    return applyPackDirectoryCandidate(detection.detectedRootPath);
  });
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
  registerLauncherStateHandler("launcher:rescan-pack-directory", () => (
    withMembershipContextMutation(
      "pack-rescan",
      () => withRemoteContext(service.rescanPackDirectory()),
    )
  ));
  registerLauncherStateHandler("launcher:set-library-preferences", (_event, patch) => service.setLibraryPreferencesFromGui(patch));
  registerLauncherStateHandler("launcher:toggle-library-favorite", (_event, packKey) => service.toggleLibraryFavoriteFromGui(packKey));
  registerLauncherStateHandler("launcher:remove-known-account", (_event, userId) => withMembershipContextMutation("remove-account", () => {
    service.cancelPendingAutoSubmit("remove-account");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("remove-account");
    return withRemoteContext(service.removeKnownAccountFromGui(userId));
  }));
  registerLauncherStateHandler("launcher:switch-account", (_event, userId) => withAccountProfileRefreshAfterMutation("switch-account", () => (
    withRemoteContext(service.switchKnownAccountFromGui(userId, {
      connected: isCommittedConnected(connectivity?.getState()),
    }))
  )));
  registerLauncherStateHandler("launcher:use-library-pack", (_event, packId) => withMembershipContextMutation("pack-change", () => (
    withRemoteContext(service.activateLibraryPack(packId, {
      deferRemoteMembership: true,
    }))
  )));
  registerLauncherStateHandler("launcher:open-membership-url", async () => {
    const state = await service.getLauncherState({ deferRemoteMembership: true });
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
    const state = await service.getLauncherState({ deferRemoteMembership: true });
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
    const stableState = membershipStartupCoordinator?.invalidate("manual-membership") || null;
    cancelManualMembershipRun("manual-membership");
    service.cancelPendingAutoSubmit("manual-membership");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("manual-membership");
    const runId = ++manualMembershipRunSequence;
    activeManualMembershipRun = { connectionGeneration: null, contextKey: null, runId };
    const staleResult = () => ({
      action: "check-membership",
      lines: ["La comprobación anterior se descartó porque cambió la cuenta o el pack."],
      ok: false,
      stale: true,
      state: null,
      summary: "Comprobación de participación descartada.",
    });
    try {
      const initialState = stableState || await service.getLauncherState({ deferRemoteMembership: true });
      if (activeManualMembershipRun?.runId !== runId) return staleResult();
      const contextKey = membershipResolutionContext(initialState).key;
      activeManualMembershipRun.contextKey = contextKey;
      const preparedConnection = await prepareRemoteAction("membership");
      if (activeManualMembershipRun?.runId !== runId) return staleResult();
      if (preparedConnection?.reachability !== "connected") {
        return {
          action: "check-membership",
          lines: ["Recupera la conexión para comprobar tu participación."],
          ok: false,
          state: initialState,
          summary: "No hay conexión confirmada.",
        };
      }
      activeManualMembershipRun.connectionGeneration = Number(preparedConnection.reachabilityGeneration) || 0;
      const result = await service.recheckSeasonMembership();
      const resultContextKey = membershipResolutionContext(result?.state).key;
      const finalConnection = connectivity.getState();
      if (activeManualMembershipRun?.runId !== runId
        || (contextKey && resultContextKey !== contextKey)
        || finalConnection.reachability !== "connected"
        || Number(finalConnection.reachabilityGeneration) !== Number(activeManualMembershipRun.connectionGeneration)) {
        return staleResult();
      }
      return result;
    } finally {
      if (activeManualMembershipRun?.runId === runId) activeManualMembershipRun = null;
    }
  });
  registerLauncherStateHandler("launcher:diagnose", () => service.runDiagnose());
  registerLauncherStateHandler("launcher:play-competition", async (event) => {
    await prepareRemoteAction("play-preflight", { force: true });
    const membershipResolutionActive = membershipStartupCoordinator?.isActive() || membershipCoordinationPaused();
    if (membershipResolutionActive) {
      const state = membershipStartupCoordinator?.getCurrentState()
        || await service.getLauncherState({ deferRemoteMembership: true });
      if (membershipResolutionBlocksCompetition(state, true)) {
        return {
          action: "play-competition",
          launchAttempted: false,
          lines: ["Comprobando participación."],
          mameSpawned: false,
          ok: false,
          phase: "preflight-rejected",
          reason: "membership-not-confirmed",
          state,
          summary: "Comprobando participación.",
        };
      }
    }
    const readPreflightState = async () => syncRemoteContext(
      await service.getLauncherState({ deferRemoteMembership: true }),
      { coordinateMembership: false, refreshWeekCapabilities: false, scheduleAutoSubmit: false },
    );
    return runCompetitionPlayPreflight({
      ensureFreshCapability: (weekId) => weekCapabilities.ensureFreshCapability(weekId, "play-preflight"),
      getAuthorityContext: () => ({
        connected: isCommittedConnected(connectivity.getState()),
        reachabilityGeneration: Number(connectivity.getState().reachabilityGeneration) || 0,
        ...weekCapabilities.getAuthorityContext(),
      }),
      getState: readPreflightState,
      launch: (playOptions) => withRemoteContext(service.playCompetition({
        ...playOptions,
        onMamePhase: (phase) => sendBusyPhase(
          event,
          phase === "mame-spawned" ? "Competición en curso" : "Cerrando competición",
          phase,
        ),
      })),
    });
  });
  registerLauncherStateHandler("launcher:practice", (event) => service.playPractice({
    onMamePhase: (phase) => sendBusyPhase(
      event,
      phase === "mame-spawned" ? "Práctica en curso" : "Cerrando práctica",
      phase,
    ),
  }));
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
        state: await service.getLauncherState({ deferRemoteMembership: true }),
        summary: "Accion disponible solo en desarrollo.",
      };
    }
    const result = guarded.value;
    return {
      action: "force-account-sync",
      lines: [`Cuentas procesadas: ${Number(result?.processedAccounts) || 0}.`],
      ok: result?.status !== "deferred",
      state: await service.getLauncherState({ deferRemoteMembership: true }),
      summary: result?.status === "deferred" ? "La sincronizacion queda pendiente." : "Sincronizacion de cuentas completada.",
    };
  });
  registerLauncherStateHandler("launcher:restore-failed", (_event, filename) => withRemoteContext(service.restoreFailedSubmission(filename)));
  registerLauncherStateHandler("launcher:sync-plugin", () => service.syncPlugin());
  registerLauncherStateHandler("launcher:logout", () => withMembershipContextMutation("logout", () => {
    service.cancelPendingAutoSubmit("logout");
    pendingAutoSubmitCoordinator?.cancelCurrentRun("logout");
    return withRemoteContext(service.logoutSession());
  }));
}

const hasSingleInstanceLock = installSingleInstancePolicy(app, () => mainWindow);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    writePackagedSmokeReport("main-ready");
    if (process.platform === "win32") app.setAppUserModelId("com.highscoreleague.launcher");
    themeAuthority = createThemeAuthority({
      readSystemTheme,
      userDataDir: app.getPath("userData"),
    });
    const startupPreferenceScope = await resolvePlayerPreferenceScope({ userDataDir: app.getPath("userData") });
    await themeAuthority.initialize(startupPreferenceScope);
    recordStartupMilestone("theme-resolved");
    initializeSecureSessionStorage();
    initializeRemoteServices();
    registerIpc();
    localStartupPromise = Promise.all([service.migrateRememberedSessionsForGui(), weekAuthorityStartupPromise])
      .then(async () => {
        const startupSession = await service.getAuthStateForGui();
        presence?.setActiveUserId(startupSession.hasSession ? startupSession.userId : null).catch(() => {});
        await service.initializePlayTime();
        service.requestPlayTimeSync("startup-local-ready").catch(() => {});
        return [];
      })
      .catch(() => []);
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
