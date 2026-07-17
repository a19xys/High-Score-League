const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  readKnownAccounts,
  toSafeAccountsState,
} = require("../src/account-store");
const { loadConfig } = require("../src/config");
const { normalizeHslOrigin } = require("../src/hsl-origin");
const {
  emptyAutoSyncState,
  getAutoSyncDisplayState,
  shouldAutoSync,
  summarizeAutoSyncAttempt,
} = require("../src/auto-sync");
const {
  getAccountSessionRepository,
  getAuthState,
  logoutLocal,
  resolveCanonicalSessionResult,
  signInWithPassword,
} = require("../src/auth");
const {
  isSessionDeferred,
  isSessionLocallyAvailable,
  isSessionRemoteUsable,
  requiresSessionLogin,
} = require("../src/session-result");
const { buildDiagnoseReport } = require("../src/diagnose");
const { writeDiagnosticReport } = require("../src/diagnostic-logs");
const { listJsonFiles, readEventFile } = require("../src/event-files");
const { launchMame, launchMameDetailed } = require("../src/mame-launcher");
const { evaluatePackReadiness } = require("../src/pack-readiness");
const {
  importPackFromFolder: importPackFolder,
  importPackFromZip: importPackZip,
  PackImportError,
} = require("../src/pack-importer");
const { getDirectoryKey, readPackDirectory, setPackDirectory } = require("../src/pack-directory");
const { scanPackLibrary } = require("../src/pack-library");
const { readLibrarySelection, writeLibrarySelection } = require("../src/library-selection");
const {
  readLibraryFavorites,
  readLibraryPreferences,
  toggleLibraryFavorite,
  writeLibraryPreferences,
} = require("../src/library-preferences");
const {
  resolvePackManual,
  resolvePackRanking,
  toRendererContentState,
} = require("../src/pack-content");
const { prepareV2CompetitionRun } = require("../src/mame-plugin-run");
const { loadPackFromDir, resolvePackMamePaths } = require("../src/pack");
const { readRecentPackState, writeLastOpenedPack } = require("../src/recent-packs");
const { writeSharedMameRuntime } = require("../src/shared-mame-runtime");
const { printSyncPluginResult, syncPluginToPack } = require("../src/dev-sync-plugin");
const { submitAll } = require("../src/submission-service");
const { combineAbortSignals } = require("../src/remote-request");
const { moveFileSafe, readFailureNote, restoreBoxToPending } = require("../src/file-queue");
const {
  applyScopedQueue,
  buildPlayerPendingIndex,
  buildScopedSubmitConfig,
  derivePlayerKey,
  discoverPlayerPendingScopes,
  ensureScopedQueue,
  hashPart,
} = require("../src/scoped-queue");
const {
  checkSeasonMembership,
  shouldBlockCompetition,
} = require("../src/season-membership");

let activeOpenedPack = null;
let activeLibraryIssue = null;
let activeLibrarySelection = null;
let recentPackNotices = [];
let autoSyncInProgress = false;
let autoSyncState = emptyAutoSyncState();
let interactiveRemoteController = new AbortController();
let pendingAutoSubmitEpoch = 0;
let pendingAutoSubmitController = new AbortController();
let pendingAutoSubmitState = {
  connectedGeneration: null,
  failed: 0,
  inFlight: false,
  lastRunAt: null,
  pendingFound: 0,
  preserved: 0,
  scopes: 0,
  sent: 0,
  skippedScopes: 0,
  trigger: null,
  user: null,
};
let remoteDiagnosticsProvider = null;
let remoteOperationSignalProvider = null;
const libraryOrderModule = import("./shared/library-order.mjs");
const accountSessionStates = new Map();

function sessionRepository(config = loadRuntimeConfig()) {
  return getAccountSessionRepository(config);
}

const accountSessionCoordinator = {
  async resolve(account, config, options = {}) {
    const resolveSessionResult = options.resolveSessionResultImpl || resolveCanonicalSessionResult;
    const result = await resolveSessionResult(config, {
      connected: options.connected === true,
      force: options.force === true,
      userId: account.userId,
    });
    const state = {
      accessTokenExpiresAt: result.storedSession?.session?.expires_at || null,
      active: options.active === true,
      hasLocalSession: isSessionLocallyAvailable(result),
      pendingCount: accountSessionStates.get(account.userId)?.pendingCount || 0,
      remoteUsable: isSessionRemoteUsable(result),
      requiresLogin: requiresSessionLogin(result),
      sessionRevision: Number(result.sessionRevision) || 0,
      status: result.status,
      userHash: `user_${hashPart(account.userId, 12)}`,
    };
    accountSessionStates.set(account.userId, state);
    return {
      remembered: result,
      remoteUsable: state.remoteUsable,
      requiresLogin: state.requiresLogin,
      sessionResult: result,
      sessionRevision: state.sessionRevision,
      status: result.status,
      storedSession: result.storedSession,
    };
  },
  getDiagnostics() { return [...accountSessionStates.values()].map((state) => ({ ...state })); },
  getState(userId) { return accountSessionStates.get(userId) || null; },
  setPendingCount(userId, pendingCount) {
    const state = accountSessionStates.get(userId);
    if (!state) return null;
    const next = { ...state, pendingCount: Math.max(0, Number(pendingCount) || 0) };
    accountSessionStates.set(userId, next);
    return next;
  },
};

function loadRuntimeConfig() {
  return loadConfig();
}

function getRemoteBootstrapState() {
  const config = loadRuntimeConfig();

  return {
    hslOrigin: config.hslOrigin || null,
    originSource: config.remoteConfiguration?.source || "none",
    remoteConfiguration: config.remoteConfiguration,
    webBaseUrl: config.hslOrigin || null,
  };
}

function getPackPluginName(pack) {
  return pack?.mame?.pluginName || pack?.capture?.pluginName || pack?.contract?.capture?.pluginName || pack?.plugin?.name || "hsl-score";
}

function setRemoteDiagnosticsProvider(provider) {
  remoteDiagnosticsProvider = typeof provider === "function" ? provider : null;
}

function setRemoteOperationSignalProvider(provider) {
  remoteOperationSignalProvider = typeof provider === "function" ? provider : null;
}

function getRemoteOperationSignal() {
  return remoteOperationSignalProvider?.() || null;
}

function invalidateInteractiveRemoteOperations(reason = "context-change") {
  interactiveRemoteController.abort(reason);
  interactiveRemoteController = new AbortController();
}

function getPendingAutoSubmitDiagnostics() {
  return { ...pendingAutoSubmitState };
}

async function getPendingAutoSubmitContext(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const session = await getAuthState(config, { deferRemote: true });
  const index = await buildPlayerPendingIndex(config, session);
  return {
    config,
    connection: options.connection || null,
    index,
    playerKey: index.playerKey,
    session,
    userId: options.userId || null,
    webBaseUrl: config.webBaseUrl || null,
  };
}

async function getPendingAutoSubmitContexts(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const accountsStore = await readKnownAccounts(config);
  const activeUserId = options.activeUserId || accountsStore.lastActiveUserId || null;
  const ordered = [...accountsStore.accounts].sort((left, right) => {
    if (left.userId === activeUserId) return -1;
    if (right.userId === activeUserId) return 1;
    return String(left.userId).localeCompare(String(right.userId));
  });
  const accountContexts = [];
  const accounts = [];
  const totals = { invalidPending: 0, pending: 0, validPending: 0 };
  const sessionSummary = {
    loginRequiredPendingCount: 0,
    sessionDeferredPendingCount: 0,
    unavailablePendingCount: 0,
  };
  for (const account of ordered) {
    const resolved = await accountSessionCoordinator.resolve(account, config, {
      active: account.userId === activeUserId,
      connected: options.connection?.reachability === "connected",
      force: options.forceSessionRefresh === true,
      resolveSessionResultImpl: options.resolveSessionResultImpl,
    });
    const item = {
      active: account.userId === activeUserId,
      hasLocalSession: isSessionLocallyAvailable(resolved.sessionResult),
      remoteUsable: isSessionRemoteUsable(resolved.sessionResult),
      requiresLogin: requiresSessionLogin(resolved.sessionResult),
      sessionRevision: resolved.sessionRevision || 0,
      status: resolved.status,
      userHash: `user_${hashPart(account.userId, 12)}`,
    };
    const accountSession = {
      email: resolved.storedSession?.user?.email || account.email || null,
      hasSession: true,
      userId: account.userId,
    };
    const index = await buildPlayerPendingIndex(config, accountSession);
    item.pendingCount = index.totals.pending;
    item.queueRevision = index.revision;
    totals.invalidPending += index.totals.invalidPending;
    totals.pending += index.totals.pending;
    totals.validPending += index.totals.validPending;
    accountSessionCoordinator.setPendingCount(account.userId, index.totals.pending);
    accounts.push(item);
    if (!isSessionRemoteUsable(resolved.sessionResult) || !resolved.storedSession) {
      if (index.totals.pending > 0) {
        if (requiresSessionLogin(resolved.sessionResult)) {
          sessionSummary.loginRequiredPendingCount += index.totals.pending;
        } else if (isSessionDeferred(resolved.sessionResult)) {
          sessionSummary.sessionDeferredPendingCount += index.totals.pending;
        } else {
          sessionSummary.unavailablePendingCount += index.totals.pending;
        }
      }
      continue;
    }
    accountContexts.push({
      account,
      active: item.active,
      config,
      index,
      playerKey: index.playerKey,
      session: accountSession,
      sessionResult: resolved.sessionResult,
      sessionStatus: resolved.status,
      sessionRevision: item.sessionRevision,
      storedSession: resolved.storedSession,
      userId: account.userId,
      webBaseUrl: config.webBaseUrl || null,
    });
  }
  Object.defineProperty(accountContexts, "sessionSummary", {
    enumerable: false,
    value: Object.freeze({ ...sessionSummary }),
  });
  const stableAccounts = [...accounts].sort((left, right) => left.userHash.localeCompare(right.userHash));
  const revision = hashPart(JSON.stringify(stableAccounts.map((account) => [
    account.userHash,
    account.queueRevision,
  ])), 32);
  return {
    accountContexts,
    accounts,
    connection: options.connection || null,
    index: { revision, totals },
    playerKey: "remembered-accounts",
    session: { hasSession: true, userId: "remembered-accounts" },
    sessionRevision: hashPart(JSON.stringify(stableAccounts.map((account) => [account.userHash, account.sessionRevision])), 16),
    userId: "remembered-accounts",
    webBaseUrl: config.webBaseUrl || null,
  };
}

function cancelPendingAutoSubmit(reason = "context-change") {
  pendingAutoSubmitEpoch += 1;
  pendingAutoSubmitController.abort(reason);
  pendingAutoSubmitController = new AbortController();
  pendingAutoSubmitState = { ...pendingAutoSubmitState, cancelReason: reason };
}

function deriveOpenedPackConfig(baseConfig, pack) {
  const trustedWebBaseUrl = baseConfig.hslOrigin !== undefined
    ? baseConfig.hslOrigin
    : baseConfig.globalWebBaseUrl !== undefined
      ? baseConfig.globalWebBaseUrl
      : baseConfig.webBaseUrl || null;
  const declaredWebBaseUrl = pack.webBaseUrl || null;
  let originWarning = null;
  const declaredOrigin = declaredWebBaseUrl ? normalizeHslOrigin(declaredWebBaseUrl) : null;
  if (declaredWebBaseUrl && !declaredOrigin) {
    originWarning = "El webBaseUrl del pack no es un origen valido y se ha ignorado.";
  } else if (declaredOrigin && trustedWebBaseUrl && declaredOrigin !== normalizeHslOrigin(trustedWebBaseUrl)) {
    originWarning = "El webBaseUrl del pack no coincide con el origen HSL del launcher y se ha ignorado.";
  }
  const normalizedPack = {
    ...pack,
    declaredWebBaseUrl,
    metadataWarnings: [
      ...(pack.metadataWarnings || []),
      ...(originWarning ? [originWarning] : []),
    ],
    webBaseUrl: trustedWebBaseUrl,
  };
  const pluginName = getPackPluginName(pack);
  const requiresSharedMameRuntime = pack?.packVersion === 2 || pack?.contract?.version === 2;
  const mame = {
    ...resolvePackMamePaths(
      {
        ...pack,
        mame: {
          ...pack.mame,
          pluginName,
        },
      },
      pack.packRoot
    ),
    pluginName,
  };
  const eventsBaseDirAbs = requiresSharedMameRuntime
    ? baseConfig.eventsBaseDirAbs || path.join(baseConfig.userDataDir, "events")
    : path.join(mame.workingDir, "plugins", pluginName, "events");
  const eventsFailedDirAbs = requiresSharedMameRuntime
    ? baseConfig.eventsFailedDirAbs || path.join(eventsBaseDirAbs, "failed")
    : path.join(eventsBaseDirAbs, "failed");
  const eventsPendingDirAbs = requiresSharedMameRuntime
    ? baseConfig.eventsPendingDirAbs || path.join(eventsBaseDirAbs, "pending")
    : path.join(eventsBaseDirAbs, "pending");
  const eventsSentDirAbs = requiresSharedMameRuntime
    ? baseConfig.eventsSentDirAbs || path.join(eventsBaseDirAbs, "sent")
    : path.join(eventsBaseDirAbs, "sent");
  const eventQueueRole = requiresSharedMameRuntime ? "legacy-global" : "plugin-staging";

  return {
    ...baseConfig,
    configSource: "pack abierto",
    defaultWeekId: pack.weekId,
    eventsBaseDirAbs,
    eventsFailedDir: null,
    eventsFailedDirAbs,
    eventsPendingDir: null,
    eventsPendingDirAbs,
    eventsSentDir: null,
    eventsSentDirAbs,
    eventsSource: requiresSharedMameRuntime ? baseConfig.eventsSource || "userData" : "opened-pack",
    eventQueueRole,
    legacyEventsBaseDirAbs: requiresSharedMameRuntime ? eventsBaseDirAbs : null,
    legacyEventsFailedDirAbs: requiresSharedMameRuntime ? eventsFailedDirAbs : null,
    legacyEventsPendingDirAbs: requiresSharedMameRuntime ? eventsPendingDirAbs : null,
    legacyEventsSentDirAbs: requiresSharedMameRuntime ? eventsSentDirAbs : null,
    mame,
    mameSource: requiresSharedMameRuntime ? "shared-runtime-pending" : "opened-pack",
    pack: normalizedPack,
    packErrors: pack.errors || [],
    packLoaded: true,
    packPath: pack.packPath,
    packRoot: pack.packRoot,
    requiresSharedMameRuntime,
    webBaseUrl: trustedWebBaseUrl,
  };
}

function deriveLibraryIssueConfig(baseConfig, item) {
  const pack = {
    contractStatus: item.contractStatus || null,
    deprecated: Boolean(item.deprecated),
    duplicateGroup: false,
    duplicatePackId: Boolean(item.duplicatePackId),
    duplicatePaths: item.duplicatePaths || [],
    errors: item.errors || [],
    gameId: item.gameId || null,
    metadata: {
      assets: {
        cover: item.cover || null,
        hero: item.hero || null,
        icon: item.icon || null,
        logo: item.logo || null,
      },
      developer: item.developer || null,
      genre: item.genre || [],
      publisher: item.publisher || null,
      shortDescription: "Este pack necesita atencion antes de poder jugarse.",
      subtitle: item.subtitle || null,
      title: item.title,
      year: item.year || null,
    },
    packId: item.packId || null,
    packRoot: item.packDir || null,
    rom: item.rom || null,
    seasonId: item.seasonId || null,
    seasonName: item.seasonName || null,
    seasonSlug: item.seasonSlug || null,
    weekId: item.weekId || null,
    weekNumber: item.weekNumber || null,
  };

  return {
    ...baseConfig,
    configSource: "pack con errores",
    defaultWeekId: item.weekId || null,
    pack,
    packErrors: item.errors || [],
    packLoaded: true,
    packPath: item.packPath || null,
    packRoot: item.packDir || null,
    webBaseUrl: baseConfig.webBaseUrl,
  };
}

function getEffectiveConfig(baseConfigOverride = null) {
  const baseConfig = baseConfigOverride || loadRuntimeConfig();

  if (activeLibraryIssue) {
    return deriveLibraryIssueConfig(baseConfig, activeLibraryIssue);
  }

  if (!activeOpenedPack) {
    return baseConfig;
  }

  return deriveOpenedPackConfig(baseConfig, activeOpenedPack.pack);
}

function deriveNoActivePackConfig(baseConfig) {
  return {
    ...baseConfig,
    defaultWeekId: null,
    pack: null,
    packErrors: [],
    packLoaded: false,
    packPath: null,
    packRoot: null,
    requiresSharedMameRuntime: false,
  };
}

function clearActiveLibrarySelection() {
  activeOpenedPack = null;
  activeLibraryIssue = null;
  activeLibrarySelection = null;
}

function normalizedPath(value) {
  return getDirectoryKey(value);
}

function findRememberedLibraryPack(packs, libraryRoot, remembered) {
  if (!remembered) {
    return null;
  }

  const byInstance = remembered.instanceKey
    ? packs.find((pack) => pack.instanceKey === remembered.instanceKey)
    : null;

  if (byInstance) {
    return byInstance;
  }

  if (!remembered.relativePackPath) {
    return null;
  }

  const rememberedPath = normalizedPath(path.resolve(libraryRoot, remembered.relativePackPath));
  return packs.find((pack) => normalizedPath(pack.packDir) === rememberedPath) || null;
}

async function readRememberedLibraryPack(config, library) {
  const libraryRoot = library.directory?.path || null;
  const stored = await readLibrarySelection(config, libraryRoot);
  const storedPack = findRememberedLibraryPack(library.packs, libraryRoot, stored.selection);

  if (stored.selection) {
    return {
      candidate: storedPack,
      error: stored.error,
      rememberedInstanceKey: stored.selection.instanceKey,
    };
  }

  const legacy = await readRecentPackState(config);
  const legacyPack = legacy.lastOpenedPackDir
    ? library.packs.find((pack) => normalizedPath(pack.packDir) === normalizedPath(legacy.lastOpenedPackDir))
    : null;

  if (legacyPack) {
    await writeLibrarySelection(config, libraryRoot, legacyPack).catch(() => null);
  }

  return {
    candidate: legacyPack,
    error: stored.error || legacy.error,
    rememberedInstanceKey: legacyPack?.instanceKey || null,
  };
}

function materializeLibrarySelection(pack, libraryRoot, source) {
  clearActiveLibrarySelection();

  if (!pack?.instanceKey || !pack?.packDir) {
    return false;
  }

  if (pack.status === "error" || pack.duplicatePackId) {
    activeLibraryIssue = {
      ...pack,
      selectedAt: new Date().toISOString(),
    };
  } else {
    const result = readPackForGui(pack.packDir);

    if (!result.ok) {
      activeLibraryIssue = {
        ...pack,
        errors: [...new Set([...(pack.errors || []), ...(result.errors || [])])],
        selectedAt: new Date().toISOString(),
        status: "error",
      };
    } else {
      activeOpenedPack = {
        openedAt: new Date().toISOString(),
        pack: result.pack,
        remembered: source === "remembered",
      };
    }
  }

  activeLibrarySelection = {
    instanceKey: pack.instanceKey,
    libraryRootKey: getDirectoryKey(libraryRoot),
    packDir: pack.packDir,
    source,
  };
  return true;
}

async function reconcileLibrarySelection(config, library, preferences = {}) {
  const libraryRoot = library.directory?.path || null;
  const rootKey = getDirectoryKey(libraryRoot);
  const remembered = libraryRoot
    ? await readRememberedLibraryPack(config, library)
    : { candidate: null, error: null, rememberedInstanceKey: null };
  const selectable = library.status === "available-populated" && library.packs.length > 0;

  if (!selectable) {
    clearActiveLibrarySelection();
    return {
      activeInstanceKey: null,
      activePackDir: null,
      rememberedInstanceKey: remembered.rememberedInstanceKey,
      rootKey,
      source: "none",
      warning: remembered.error || null,
    };
  }

  const { sortPacks } = await libraryOrderModule;
  const ordered = sortPacks(library.packs, preferences);
  const active = activeLibrarySelection?.libraryRootKey === rootKey
    ? ordered.find((pack) => pack.instanceKey === activeLibrarySelection.instanceKey) || null
    : null;
  const candidate = active || remembered.candidate || ordered[0] || null;
  const source = active
    ? activeLibrarySelection.source
    : remembered.candidate
      ? "remembered"
      : candidate
        ? "first-available"
        : "none";

  if (!materializeLibrarySelection(candidate, libraryRoot, source)) {
    return {
      activeInstanceKey: null,
      activePackDir: null,
      rememberedInstanceKey: remembered.rememberedInstanceKey,
      rootKey,
      source: "none",
      warning: "No se pudo materializar una instancia real de la biblioteca.",
    };
  }

  let warning = remembered.error || null;

  if (!active && candidate) {
    try {
      await writeLibrarySelection(config, libraryRoot, candidate);
      await writeLastOpenedPack(config, candidate.packDir);
    } catch (error) {
      warning = `No se pudo recordar la selección de biblioteca: ${normalizeMessage(error)}`;
    }
  }

  return {
    activeInstanceKey: candidate.instanceKey,
    activePackDir: candidate.packDir,
    rememberedInstanceKey: candidate.instanceKey,
    rootKey,
    source,
    warning,
  };
}

function normalizeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createNotice(level, summary, details = []) {
  return {
    details,
    id: `${level}:${summary}:${details.join("|")}`,
    level,
    summary,
  };
}

function classifyFailureReason(reason, errors = []) {
  const technicalReason = [reason, ...errors].filter(Boolean).join("; ");

  if (!technicalReason) {
    return {
      friendlyReason: "No se pudo enviar esta puntuacion.",
      technicalReason: null,
    };
  }

  if (
    /temporada|season|no pertenece|not joined|not a member|not member|not participant|not registered/i.test(technicalReason)
  ) {
    return {
      friendlyReason: "Tu cuenta no esta unida a esta temporada. Unete desde la web y vuelve a intentarlo.",
      technicalReason,
    };
  }

  if (/401|auth|token|sesion|session|unauthorized|no autorizado/i.test(technicalReason)) {
    return {
      friendlyReason: "La sesion no es valida. Inicia sesion de nuevo y vuelve a intentarlo.",
      technicalReason,
    };
  }

  if (/JSON|schemaVersion|score|rom|detectedAt|source/i.test(technicalReason)) {
    return {
      friendlyReason: "El archivo de puntuacion necesita revision antes de enviarse.",
      technicalReason,
    };
  }

  return {
    friendlyReason: technicalReason,
    technicalReason,
  };
}

async function pathIsDirectory(targetPath) {
  try {
    const stat = await fsp.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function readPackForGui(packDir) {
  try {
    const result = loadPackFromDir(packDir);

    if (!result.loaded) {
      return {
        code: "missing_pack_json",
        errors: ["No encuentro pack.json en esta carpeta. Elige la carpeta raíz del pack o crea un pack.json a partir del ejemplo de desarrollo."],
        ok: false,
        packDir,
        packPath: result.packPath,
      };
    }

    if (result.errors.length > 0) {
      return {
        code: "invalid_pack",
        errors: result.errors,
        ok: false,
        packDir,
        packPath: result.packPath,
      };
    }

    return {
      code: "ok",
      errors: [],
      ok: true,
      pack: result.pack,
      packDir,
      packPath: result.packPath,
    };
  } catch (error) {
    return {
      code: "invalid_pack",
      errors: [normalizeMessage(error)],
      ok: false,
      packDir,
      packPath: path.join(packDir, "pack.json"),
    };
  }
}

async function resolveRememberedPack(config) {
  const recent = await readRecentPackState(config);

  if (recent.error) {
    return {
      notice: createNotice("warning", "No se pudo leer el último pack recordado.", [recent.error]),
      ok: false,
      pack: null,
      reason: "recent_read_error",
    };
  }

  if (!recent.lastOpenedPackDir) {
    return {
      notice: null,
      ok: false,
      pack: null,
      reason: "empty",
    };
  }

  if (!(await pathIsDirectory(recent.lastOpenedPackDir))) {
    return {
      notice: createNotice(
        "warning",
        "No se pudo cargar el último pack. Puedes abrirlo de nuevo.",
        ["La carpeta recordada ya no existe o no es accesible."]
      ),
      ok: false,
      pack: null,
      reason: "missing_dir",
    };
  }

  const result = readPackForGui(recent.lastOpenedPackDir);

  if (!result.ok) {
    return {
      notice: createNotice(
        "warning",
        "No se pudo cargar el último pack. Puedes abrirlo de nuevo.",
        result.errors
      ),
      ok: false,
      pack: null,
      reason: result.code,
    };
  }

  return {
    notice: createNotice("ok", "Último pack cargado correctamente.", [
      result.pack.packId || result.pack.gameId,
    ]),
    ok: true,
    pack: result.pack,
    reason: "ok",
  };
}

async function ensureRememberedPackLoaded() {
  const config = loadRuntimeConfig();
  const session = await getAuthState(config, { deferRemote: true });
  const [library, preferences] = await Promise.all([
    scanPackLibrary(config),
    readLibraryPreferences(config, session),
  ]);
  await reconcileLibrarySelection(config, library, preferences);
}

async function captureConsoleAsync(fn) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.log = (line = "") => lines.push(String(line));
  console.error = (line = "") => lines.push(String(line));
  process.exitCode = undefined;

  try {
    const result = await fn();
    return {
      exitCode: process.exitCode || 0,
      lines,
      result,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

function summarizeDiagnoseReport(report) {
  const sectionSummaries = Object.entries(report.sections).map(([name, entries]) => {
    const counts = entries.reduce(
      (acc, entry) => {
        acc[entry.level] = (acc[entry.level] || 0) + 1;
        return acc;
      },
      {}
    );

    return {
      name,
      counts,
      entries: entries.map((entry) => ({
        detail: entry.detail,
        level: entry.level,
        message: entry.message,
      })),
    };
  });

  return {
    errorCount: report.errors.length,
    hasErrors: report.errors.length > 0,
    recommendationCount: new Set(report.recommendations).size,
    recommendations: [...new Set(report.recommendations)],
    sections: sectionSummaries,
    warningCount: report.warnings.length,
  };
}

function eventResultToQueueItem(box, result, metadata = {}) {
  return {
    box,
    detectedAt: result.event?.detectedAt || null,
    errors: result.errors || [],
    filename: result.filename,
    failure: metadata.failure || null,
    fullPath: result.fullPath,
    game: result.event?.game || null,
    ok: result.ok,
    rom: result.event?.rom || null,
    score: Number.isFinite(result.event?.score) ? result.event.score : null,
    source: result.event?.source || null,
    warnings: result.warnings || [],
  };
}

async function readQueueBox(dir, box, config = null) {
  try {
    const files = await listJsonFiles(dir);
    const items = [];

    for (const filename of files) {
      const result = await readEventFile(dir, filename);
      let metadata = {};

      if (box === "failed" && config) {
        const note = await readFailureNote(config, filename);
        const reason = note.reason || (result.errors || []).join("; ") || null;
        const classified = classifyFailureReason(reason, result.errors || []);
        metadata = {
          failure: {
            failedAt: note.failedAt,
            friendlyReason: classified.friendlyReason,
            noteExists: note.exists,
            notePath: note.notePath,
            technicalReason: classified.technicalReason,
          },
        };
      }

      items.push(eventResultToQueueItem(box, result, metadata));
    }

    return {
      box,
      count: files.length,
      dir,
      exists: true,
      items,
      validCount: items.filter((item) => item.ok).length,
    };
  } catch (error) {
    return {
      box,
      count: 0,
      dir,
      error: normalizeMessage(error),
      exists: false,
      items: [],
      validCount: 0,
    };
  }
}

function emptyQueueBox(dir, box, reason = null) {
  return {
    box,
    count: 0,
    dir,
    error: reason,
    exists: false,
    items: [],
    validCount: 0,
  };
}

async function getQueueState(config) {
  const [pending, sent, failed] = await Promise.all([
    readQueueBox(config.eventsPendingDirAbs, "pending", config),
    readQueueBox(config.eventsSentDirAbs, "sent", config),
    readQueueBox(config.eventsFailedDirAbs, "failed", config),
  ]);

  return {
    failed,
    pending,
    sent,
    totals: {
      failed: failed.count,
      pending: pending.count,
      sent: sent.count,
    },
  };
}

function getEmptyQueueState(config, reason) {
  const pending = emptyQueueBox(config.eventsPendingDirAbs, "pending", reason);
  const sent = emptyQueueBox(config.eventsSentDirAbs, "sent", reason);
  const failed = emptyQueueBox(config.eventsFailedDirAbs, "failed", reason);

  return {
    failed,
    pending,
    sent,
    totals: {
      failed: 0,
      pending: 0,
      sent: 0,
    },
  };
}

async function getScopedGuiConfig(baseConfig, session) {
  if (!baseConfig.packLoaded || !baseConfig.pack?.rom) {
    return {
      config: baseConfig,
      reason: "Selecciona un pack real de la biblioteca para usar su cola local.",
      scope: null,
    };
  }

  if (!session?.hasSession) {
    return {
      config: baseConfig,
      reason: "Inicia sesion para usar la cola local separada por cuenta y pack.",
      scope: null,
    };
  }

  const scope = await ensureScopedQueue(baseConfig, session);

  if (!scope) {
    return {
      config: baseConfig,
      reason: "No se pudo resolver la cola local de esta cuenta.",
      scope: null,
    };
  }

  return {
    config: applyScopedQueue(baseConfig, scope),
    reason: null,
    scope,
  };
}

async function getLauncherContext(options = {}) {
  const runtimeConfig = options.config || loadRuntimeConfig();
  const session = await getAuthState(runtimeConfig, {
    deferRemote: options.connected !== true,
  });
  const [library, libraryPreferences] = await Promise.all([
    scanPackLibrary(runtimeConfig),
    readLibraryPreferences(runtimeConfig, session),
  ]);
  const selection = await reconcileLibrarySelection(runtimeConfig, library, libraryPreferences);
  const baseConfig = selection.activeInstanceKey
    ? getEffectiveConfig(runtimeConfig)
    : deriveNoActivePackConfig(runtimeConfig);
  const accountsStore = await readKnownAccounts(baseConfig);
  const membershipSignal = combineAbortSignals([
    options.signal,
    getRemoteOperationSignal(),
    interactiveRemoteController.signal,
  ]);
  let membership;
  try {
    membership = await checkSeasonMembership(baseConfig, session, {
      deferRemote: options.deferRemoteMembership === true,
      signal: membershipSignal.signal,
    });
  } finally {
    membershipSignal.dispose();
  }
  const scoped = await getScopedGuiConfig(baseConfig, session);
  const queue = scoped.scope
    ? await getQueueState(scoped.config)
    : getEmptyQueueState(baseConfig, scoped.reason);

  return {
    accountsStore,
    baseConfig,
    config: scoped.config,
    library,
    libraryPreferences,
    membership,
    queue,
    scoped,
    selection,
    session,
  };
}

async function stateFromContext(context) {
  const {
    accountsStore,
    baseConfig,
    config,
    library,
    libraryPreferences,
    membership,
    queue,
    scoped,
    selection,
    session,
  } = context;
  const autoSync = getAutoSyncDisplayState({
    autoSyncInProgress,
    membership,
    queue,
    scope: scoped.scope,
    session,
  }, autoSyncState);
  const canonicalStates = await Promise.all(accountsStore.accounts.map(async (account) => [
    account.userId,
    await sessionRepository(baseConfig).read(account.userId),
  ]));
  const savedSessionUserIds = new Set(canonicalStates.filter(([, result]) => isSessionLocallyAvailable(result)).map(([userId]) => userId));
  const sessionStatuses = new Map(canonicalStates.map(([userId, result]) => {
    const observed = accountSessionCoordinator.getState(userId);
    return [userId, {
      ...observed,
      hasLocalSession: isSessionLocallyAvailable(result),
      pendingCount: observed?.pendingCount || 0,
      remoteUsable: isSessionRemoteUsable(result),
      requiresLogin: requiresSessionLogin(result),
      sessionRevision: Number(result.sessionRevision) || Number(observed?.sessionRevision) || 0,
      status: result.status,
    }];
  }));
  const libraryFavorites = await (session.hasSession
      ? readLibraryFavorites(baseConfig, session)
      : Promise.resolve({
        favorites: {},
        filePath: null,
        playerKey: null,
        schemaVersion: 1,
        scope: "disabled",
        updatedAt: null,
        warnings: [],
      }));
  const favoriteMap = libraryFavorites.favorites || {};
  const libraryState = {
    ...library,
    favorites: {
      count: Object.keys(favoriteMap).length,
      disabled: !session.hasSession,
      filePath: libraryFavorites.filePath,
      scope: libraryFavorites.scope,
      warnings: libraryFavorites.warnings || [],
    },
    packs: library.packs.map((pack) => ({
      ...pack,
      favorite: pack.duplicatePackId ? false : Boolean(favoriteMap[pack.favoriteKey]),
      favoriteDisabled: Boolean(pack.duplicatePackId),
    })),
    preferences: libraryPreferences,
  };
  const activeLibraryPack = selection.activeInstanceKey
    ? libraryState.packs.find((pack) => pack.instanceKey === selection.activeInstanceKey) || null
    : null;
  const game = activeLibraryPack
    ? {
        ...getGameState(config, activeLibraryPack),
        favorite: Boolean(activeLibraryPack.favorite),
      }
    : null;
  const readiness = !activeLibraryPack
    ? {
        blockers: ["Selecciona un pack real de la biblioteca para continuar."],
        canPlayCompetition: false,
        canPractice: false,
        checks: [],
        message: "No hay ningún pack activo en la biblioteca actual.",
        status: "blocked",
      }
    : evaluatePackReadiness({
        autoSync,
        config,
        membership,
        queue,
        scope: scoped.scope,
        session,
      });
  const bridge = activeLibraryPack
    ? getBridgeState(config, activeLibraryPack)
    : getEmptyBridgeState(libraryState);

  return {
    accounts: toSafeAccountsState(accountsStore, session, { savedSessionUserIds, sessionStatuses }),
    activePack: activeLibraryPack,
    autoSync,
    bridge,
    configPath: config.configPath,
    game,
    library: libraryState,
    membership,
    notices: recentPackNotices,
    queue,
    readiness,
    remoteConfiguration: baseConfig.remoteConfiguration || config.remoteConfiguration || {
      hslOrigin: config.hslOrigin || null,
      message: "El launcher no tiene un origen HSL configurado.",
      source: "none",
      status: config.hslOrigin ? "configured" : "missing",
    },
    runtime: config.sharedMameRuntime || baseConfig.sharedMameRuntime || null,
    scope: scoped.scope
      ? {
          packKey: scoped.scope.packKey,
          playerKey: scoped.scope.playerKey,
          scopedQueueRoot: scoped.scope.scopedQueueRoot,
          stagingPendingDir: config.stagingEventsPendingDirAbs || null,
        }
      : null,
    selection: {
      ...selection,
      activeInstanceKey: activeLibraryPack?.instanceKey || null,
      activePackDir: activeLibraryPack?.packDir || null,
      source: activeLibraryPack ? selection.source : "none",
    },
    session,
    timestamp: new Date().toISOString(),
  };
}

async function runAutoSyncIfEligible(context, options = {}) {
  const eligibilityContext = {
    autoSyncInProgress,
    membership: context.membership,
    queue: context.queue,
    scope: context.scoped?.scope,
    session: context.session,
  };

  if (!shouldAutoSync(eligibilityContext)) {
    return {
      attempted: false,
      state: autoSyncState,
    };
  }

  const now = options.now || new Date().toISOString();
  autoSyncInProgress = true;
  autoSyncState = emptyAutoSyncState({
    lastAttemptAt: now,
    message: "Subiendo puntuaciones pendientes...",
    pendingBefore: context.queue?.totals?.pending || 0,
    status: "syncing",
  });

  try {
    const submitAllImpl = options.submitAllImpl || submitAll;
    const getQueueStateImpl = options.getQueueStateImpl || getQueueState;
    const captured = await captureConsoleAsync(() => submitAllImpl(context.config));
    const exitCode = Number.isInteger(captured.result) ? captured.result : captured.exitCode;
    const afterQueue = await getQueueStateImpl(context.config);

    autoSyncState = summarizeAutoSyncAttempt({
      afterQueue,
      beforeQueue: context.queue,
      now,
      ok: exitCode === 0,
    });

    return {
      attempted: true,
      autoSync: autoSyncState,
      exitCode,
      lines: captured.lines,
      ok: exitCode === 0,
      queue: afterQueue,
      result: captured.result || null,
    };
  } catch (error) {
    const getQueueStateImpl = options.getQueueStateImpl || getQueueState;
    const afterQueue = await getQueueStateImpl(context.config).catch(() => context.queue);

    autoSyncState = emptyAutoSyncState({
      lastAttemptAt: now,
      message: "No se pudo sincronizar automaticamente. Las puntuaciones siguen guardadas localmente.",
      pendingAfter: afterQueue?.totals?.pending ?? null,
      pendingBefore: context.queue?.totals?.pending || 0,
      reason: normalizeMessage(error),
      status: "failed",
    });

    return {
      attempted: true,
      autoSync: autoSyncState,
      error: normalizeMessage(error),
      ok: false,
      queue: afterQueue,
    };
  } finally {
    autoSyncInProgress = false;
  }
}

async function runPendingAutoSubmit(options = {}) {
  const now = options.now || new Date().toISOString();
  if (autoSyncInProgress) return { attempted: false, reason: "sync-in-progress", retryable: true, status: "deferred", terminal: false };
  const baseConfig = options.config || loadRuntimeConfig();
  const session = options.session || await (options.getAuthStateImpl || getAuthState)(baseConfig);
  const playerKey = derivePlayerKey(session);
  if (!session.hasSession || !playerKey) return { attempted: false, authFailure: true, reason: "no-session", status: "deferred", terminal: false };

  const epoch = pendingAutoSubmitEpoch;
  const combinedSignal = combineAbortSignals([
    options.signal,
    getRemoteOperationSignal(),
    pendingAutoSubmitController.signal,
  ]);
  const discovery = options.index || await (options.discoverScopesImpl || discoverPlayerPendingScopes)(baseConfig, session);
  const sessionResult = options.sessionResult || null;
  const totalPending = discovery.records.reduce((sum, item) => sum + item.pendingCount, 0);
  pendingAutoSubmitState = {
    connectedGeneration: options.connectedGeneration ?? null,
    failed: 0,
    inFlight: discovery.records.length > 0,
    lastRunAt: now,
    pendingFound: totalPending,
    preserved: totalPending,
    scopes: discovery.records.length,
    sent: 0,
    skippedScopes: discovery.skipped.length,
    trigger: options.trigger || "unknown",
    user: `player_${hashPart(playerKey, 12)}`,
    queueRevision: discovery.revision || null,
    validPending: discovery.totals?.validPending ?? totalPending,
  };
  if (discovery.records.length === 0) {
    combinedSignal.dispose();
    return { attempted: false, discovery, reason: "no-pending", status: "completed", terminal: true };
  }

  autoSyncInProgress = true;
  autoSyncState = emptyAutoSyncState({
    lastAttemptAt: now,
    message: "Subiendo puntuaciones pendientes...",
    pendingBefore: totalPending,
    status: "syncing",
  });
  let sent = 0;
  let failed = 0;
  let preserved = totalPending;
  let transportFailure = false;
  let authFailure = false;
  let attentionRequired = false;
  let cancelled = false;
  let retryable = false;
  let sessionDeferred = false;
  let retryAfterMs = null;
  let processedScopes = 0;
  const stillCurrent = () => !combinedSignal.signal.aborted && epoch === pendingAutoSubmitEpoch && options.shouldContinue?.() !== false;

  try {
    for (const record of discovery.records) {
      if (!stillCurrent()) break;
      const config = buildScopedSubmitConfig(baseConfig, record);
      const membership = await (options.checkMembershipImpl || checkSeasonMembership)(config, session, {
        sessionResult: sessionResult || undefined,
        signal: combinedSignal.signal,
      });
      if (!stillCurrent()) {
        cancelled = true;
        break;
      }
      if (membership.remoteFailure === "cancelled") {
        cancelled = true;
        break;
      }
      if (membership.authDeferred) {
        sessionDeferred = true;
        break;
      }
      const membershipRequestFailed = membership.status === "unknown" && !membership.response && membership.request;
      if (membership.retryable || membershipRequestFailed) {
        transportFailure = ["transport-failure", "timeout"].includes(membership.remoteFailure) || Boolean(membershipRequestFailed);
        retryable = true;
        retryAfterMs = Math.max(Number(retryAfterMs) || 0, Number(membership.retryAfterMs) || 0) || null;
        break;
      }
      if (["no_session", "unauthenticated"].includes(membership.status)) {
        authFailure = true;
        break;
      }
      if (membership.status !== "member" || membership.canSubmit !== true) continue;

      const beforeQueue = await (options.getQueueStateImpl || getQueueState)(config);
      let scopeTransportFailure = false;
      let scopeRetryable = false;
      await captureConsoleAsync(() => (options.submitAllImpl || submitAll)(config, {
        sessionResult: sessionResult || undefined,
        onResult(result) {
          if (["transport-failure", "timeout"].includes(result.outcome)) scopeTransportFailure = true;
          if (result.retryable) scopeRetryable = true;
          if (result.authRequired) authFailure = true;
          if (result.sessionDeferred) sessionDeferred = true;
          if (result.outcome === "cancelled") cancelled = true;
          if (result.outcome === "attention-required") attentionRequired = true;
          retryAfterMs = Math.max(Number(retryAfterMs) || 0, Number(result.retryAfterMs) || 0) || null;
        },
        signal: combinedSignal.signal,
        shouldContinue: stillCurrent,
        stopOnTransportFailure: true,
        stopOnRetryableFailure: true,
      }));
      const afterQueue = await (options.getQueueStateImpl || getQueueState)(config);
      sent += Math.max(0, afterQueue.totals.sent - beforeQueue.totals.sent);
      failed += Math.max(0, afterQueue.totals.failed - beforeQueue.totals.failed);
      preserved -= Math.max(0, beforeQueue.totals.pending - afterQueue.totals.pending);
      processedScopes += 1;
      if (scopeTransportFailure || scopeRetryable) {
        transportFailure = scopeTransportFailure;
        retryable = true;
        break;
      }
      if (authFailure || cancelled || sessionDeferred) break;
    }
  } finally {
    if (!stillCurrent()) cancelled = true;
    combinedSignal.dispose();
    autoSyncInProgress = false;
    const pendingAfter = Math.max(0, preserved);
    autoSyncState = emptyAutoSyncState({
      failedCount: failed,
      lastAttemptAt: now,
      ...(sent > 0 ? { lastSuccessAt: now } : {}),
      message: sent > 0
        ? `Se han enviado ${sent} puntuaciones pendientes.`
        : "Las puntuaciones pendientes se conservan para el proximo intento.",
      pendingAfter,
      pendingBefore: totalPending,
      reason: cancelled ? "cancelled" : transportFailure ? "transport" : retryable ? "retryable_http" : authFailure ? "auth_required" : sessionDeferred ? "session_deferred" : attentionRequired ? "attention_required" : failed > 0 ? "failed_items" : null,
      sentCount: sent,
      status: cancelled || transportFailure || retryable || authFailure || sessionDeferred ? "failed" : attentionRequired || failed > 0 ? "partial_failed" : sent > 0 ? "synced" : "idle",
    });
    pendingAutoSubmitState = {
      ...pendingAutoSubmitState,
      failed,
      inFlight: false,
      preserved: pendingAfter,
      processedScopes,
      sent,
    };
  }

  return {
    attempted: processedScopes > 0,
    attentionRequired,
    authFailure,
    cancelled,
    diagnostics: getPendingAutoSubmitDiagnostics(),
    failed,
    ok: !cancelled && !transportFailure && !retryable && !authFailure && !sessionDeferred && !attentionRequired && failed === 0 && Math.max(0, preserved) === 0,
    preserved: Math.max(0, preserved),
    sent,
    reason: cancelled ? "cancelled" : transportFailure ? "transport" : retryable ? "retryable-http" : authFailure ? "auth-required" : sessionDeferred ? "session-deferred" : attentionRequired ? "attention-required" : null,
    retryAfterMs,
    retryable,
    sessionDeferred,
    terminal: !cancelled && !transportFailure && !retryable && !authFailure && !sessionDeferred,
    transportFailure,
    status: cancelled ? "cancelled" : sessionDeferred ? "auth-deferred" : transportFailure || retryable || authFailure ? "deferred" : attentionRequired ? "attention-required" : "completed",
  };
}

async function runPendingAutoSubmitForAccounts(options = {}) {
  const contexts = options.accountContexts || [];
  const sessionSummary = contexts.sessionSummary || {};
  const sessionDeferredPendingCount = Number(sessionSummary.sessionDeferredPendingCount) || 0;
  const loginRequiredPendingCount = Number(sessionSummary.loginRequiredPendingCount) || 0;
  const aggregate = {
    attempted: false,
    attentionRequired: false,
    authDeferred: false,
    authFailure: false,
    cancelled: false,
    failed: 0,
    preserved: sessionDeferredPendingCount + loginRequiredPendingCount + (Number(sessionSummary.unavailablePendingCount) || 0),
    processedAccounts: 0,
    reason: null,
    sent: 0,
    sessionDeferred: false,
    status: "completed",
    retryAfterMs: null,
    retryable: false,
    terminal: true,
    transportFailure: false,
  };
  for (const context of contexts) {
    if (options.shouldContinue?.() === false) {
      aggregate.status = "deferred";
      break;
    }
    if (context.index.totals.pending <= 0) continue;
    const result = await (options.runAccountImpl || runPendingAutoSubmit)({
      config: context.config,
      connectedGeneration: options.connectedGeneration,
      index: context.index,
      session: context.session,
      sessionResult: context.sessionResult,
      storedSession: context.storedSession,
      shouldContinue: options.shouldContinue,
      trigger: options.trigger,
    });
    aggregate.attempted = aggregate.attempted || result.attempted;
    aggregate.failed += Number(result.failed) || 0;
    aggregate.preserved += Number(result.preserved) || 0;
    aggregate.sent += Number(result.sent) || 0;
    aggregate.processedAccounts += 1;
    aggregate.attentionRequired = aggregate.attentionRequired || result.attentionRequired === true;
    aggregate.authFailure = aggregate.authFailure || result.authFailure === true;
    aggregate.authDeferred = aggregate.authDeferred || result.sessionDeferred === true;
    aggregate.sessionDeferred = aggregate.sessionDeferred || result.sessionDeferred === true;
    aggregate.cancelled = aggregate.cancelled || result.cancelled === true || result.status === "cancelled";
    aggregate.retryable = aggregate.retryable || result.retryable === true;
    aggregate.retryAfterMs = Math.max(Number(aggregate.retryAfterMs) || 0, Number(result.retryAfterMs) || 0) || null;
    if (result.transportFailure || result.retryable || result.cancelled) {
      aggregate.transportFailure = aggregate.transportFailure || result.transportFailure === true;
      aggregate.status = "deferred";
      aggregate.terminal = false;
      break;
    }
  }
  if (loginRequiredPendingCount > 0) aggregate.authFailure = true;
  if (aggregate.authFailure) {
    aggregate.reason = "auth-required";
    aggregate.status = "deferred";
    aggregate.terminal = false;
  } else if ((sessionDeferredPendingCount > 0 || aggregate.sessionDeferred) && !aggregate.cancelled && !aggregate.retryable && !aggregate.transportFailure) {
    aggregate.authDeferred = true;
    aggregate.reason = "session-deferred";
    aggregate.sessionDeferred = true;
    aggregate.status = "auth-deferred";
    aggregate.terminal = false;
  } else if (aggregate.attentionRequired && aggregate.terminal) {
    aggregate.status = "attention-required";
  }
  return aggregate;
}

function getAccountSessionDiagnostics() {
  return {
    accounts: accountSessionCoordinator.getDiagnostics(),
    repository: sessionRepository(loadRuntimeConfig()).getDiagnosticsSnapshot(),
  };
}

async function migrateRememberedSessionsForGui() {
  const config = loadRuntimeConfig();
  return sessionRepository(config).migrateLegacy();
}

function cancelAccountSessionOperations(userId, reason = "cancelled") {
  const repository = sessionRepository(loadRuntimeConfig());
  if (userId) repository.cancelUserOperations(userId, reason);
  else repository.cancelAllOperations(reason);
}

async function drainAccountSessionOperations(options = {}) {
  return sessionRepository(options.config || loadRuntimeConfig()).drain(options);
}

async function shutdownAccountSessions(options = {}) {
  return sessionRepository(options.config || loadRuntimeConfig()).shutdown(options);
}

function resetAutoSyncStateForTests() {
  autoSyncInProgress = false;
  autoSyncState = emptyAutoSyncState();
  interactiveRemoteController.abort("test-reset");
  interactiveRemoteController = new AbortController();
  pendingAutoSubmitController.abort("test-reset");
  pendingAutoSubmitController = new AbortController();
  pendingAutoSubmitEpoch = 0;
  pendingAutoSubmitState = {
    connectedGeneration: null,
    failed: 0,
    inFlight: false,
    lastRunAt: null,
    pendingFound: 0,
    preserved: 0,
    scopes: 0,
    sent: 0,
    skippedScopes: 0,
    trigger: null,
    user: null,
  };
}

async function listPendingFileSnapshot(dir) {
  try {
    const files = await listJsonFiles(dir);
    const snapshot = new Map();

    for (const filename of files) {
      const fullPath = path.join(dir, filename);
      const stat = await fsp.stat(fullPath);
      snapshot.set(filename, {
        filename,
        mtimeMs: stat.mtimeMs,
      });
    }

    return snapshot;
  } catch {
    return new Map();
  }
}

async function adoptNewStagingEvents(stagingPendingDir, scopedPendingDir, snapshot, startedAtMs) {
  const files = await listJsonFiles(stagingPendingDir).catch(() => []);
  const adopted = [];
  const skippedLegacy = [];

  await fsp.mkdir(scopedPendingDir, { recursive: true });

  for (const filename of files) {
    const sourcePath = path.join(stagingPendingDir, filename);
    const stat = await fsp.stat(sourcePath);
    const previous = snapshot.get(filename);
    const isNew = !previous;
    const isUpdatedDuringRun = Boolean(previous && stat.mtimeMs > previous.mtimeMs && stat.mtimeMs >= startedAtMs);

    if (!isNew && !isUpdatedDuringRun) {
      skippedLegacy.push(filename);
      continue;
    }

    const finalPath = await moveFileSafe(sourcePath, path.join(scopedPendingDir, filename));
    adopted.push({
      filename,
      finalPath,
      restoredFilename: path.basename(finalPath),
    });
  }

  return {
    adopted,
    skippedLegacy,
  };
}

async function getSessionState(config) {
  try {
    const sessionResult = await resolveCanonicalSessionResult(config, { deferRemote: true });
    const storedSession = sessionResult.storedSession;

    if (!isSessionLocallyAvailable(sessionResult) || !storedSession) {
      return {
        email: null,
        hasSession: false,
        message: "No hay sesión local. Usa npm run login -- <email> en CLI.",
        remoteUsable: false,
        requiresLogin: requiresSessionLogin(sessionResult),
        sessionRevision: sessionResult.sessionRevision,
        status: sessionResult.status,
      };
    }

    const expiringSoon = isSessionDeferred(sessionResult);

    return {
      email: storedSession.user?.email || null,
      expiresAt: storedSession.session?.expires_at || null,
      hasSession: true,
      message: expiringSoon ? "Sesión local encontrada, pero expira pronto." : "Sesión local encontrada.",
      remoteUsable: isSessionRemoteUsable(sessionResult),
      requiresLogin: requiresSessionLogin(sessionResult),
      sessionRevision: sessionResult.sessionRevision,
      status: sessionResult.status,
      userId: storedSession.user?.id || null,
    };
  } catch (error) {
    return {
      email: null,
      error: normalizeMessage(error),
      hasSession: false,
      remoteUsable: false,
      requiresLogin: false,
      message: "No se pudo leer la sesión local.",
      sessionRevision: 0,
      status: "error",
    };
  }
}

function getGameState(config, activePack) {
  if (!activePack || !config.pack) {
    return null;
  }

  const rom = config.pack.rom || activePack.rom || null;
  const metadata = config.pack?.metadata || null;
  const manual = resolvePackManual(config.pack);
  const ranking = resolvePackRanking({
    ...(config.pack || {}),
    webBaseUrl: config.hslOrigin || config.webBaseUrl,
    weekId: config.pack?.weekId || config.defaultWeekId,
  }, config.webBaseUrl);
  const errors = [
    ...(config.packErrors || []),
    ...(config.pack?.errors || []),
  ];

  return {
    assets: metadata?.assets || {},
    developer: metadata?.developer || null,
    displayName: metadata?.title || activePack.title,
    duplicateGroup: config.pack?.duplicateGroup || null,
    duplicatePaths: config.pack?.duplicatePaths || [],
    errors: [...new Set(errors)],
    genre: metadata?.genre || [],
    favoriteKey: activePack.favoriteKey || null,
    gameId: config.pack?.gameId || activePack.gameId || null,
    id: activePack.id,
    instanceKey: activePack.instanceKey,
    manual: toRendererContentState(manual),
    metadataLoaded: Boolean(config.pack?.metadataLoaded),
    metadataWarnings: config.pack?.metadataWarnings || [],
    publisher: metadata?.publisher || null,
    packId: config.pack?.packId || activePack.packId || null,
    packPath: activePack.packPath || null,
    packRoot: activePack.packDir,
    ranking: toRendererContentState(ranking),
    rom,
    seasonId: config.pack?.seasonId || null,
    seasonName: config.pack?.seasonName || null,
    seasonSlug: config.pack?.seasonSlug || null,
    shortDescription: metadata?.shortDescription || null,
    subtitle: metadata?.subtitle || null,
    weekId: config.defaultWeekId || null,
    weekNumber: config.pack?.weekNumber || null,
    year: metadata?.year || null,
  };
}

function summarizeMameOutput(result) {
  if (!result || (!Array.isArray(result.stdoutLines) && !Array.isArray(result.stderrLines))) {
    return [];
  }

  const interesting = [
    ...(result.stdoutLines || []),
    ...(result.stderrLines || []),
  ].filter((line) => /HSL|hsl-score|plugin|Lua|error|warning|unknown option/i.test(line));

  if (interesting.length === 0) {
    return [];
  }

  return [
    "Salida MAME relevante:",
    ...interesting.slice(-40),
  ];
}

async function openPackContent(target, options = {}) {
  if (!target.available) {
    return {
      lines: [target.reason],
      ok: false,
      summary: target.reason,
    };
  }

  if (target.kind === "local") {
    const result = await options.openPathImpl(target.path);

    if (typeof result === "string" && result.trim() !== "") {
      return {
        lines: [result],
        ok: false,
        summary: "No se pudo abrir el manual local.",
      };
    }
  } else {
    await options.openExternalImpl(target.url);
  }

  return {
    lines: [target.kind === "local"
      ? options.localLine || "Contenido local abierto."
      : options.externalLine || "High Score League abierto en el navegador."],
    ok: true,
    summary: target.kind === "local"
      ? options.localSummary || "Contenido local abierto."
      : options.externalSummary || "Contenido web abierto.",
  };
}

async function openPackManual(options = {}) {
  await ensureRememberedPackLoaded();
  const config = options.config || getEffectiveConfig();
  const target = resolvePackManual(config.pack);
  const result = await openPackContent(target, {
    ...options,
    externalLine: "Manual abierto en el navegador.",
    externalSummary: "Manual abierto.",
    localLine: "Manual local abierto.",
    localSummary: "Manual abierto.",
  });

  return {
    action: "open-manual",
    ...result,
    state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
  };
}

async function openPackRanking(options = {}) {
  await ensureRememberedPackLoaded();
  const config = options.config || getEffectiveConfig();
  const hslOrigin = config.hslOrigin || config.webBaseUrl;
  const target = resolvePackRanking({ ...(config.pack || {}), webBaseUrl: hslOrigin }, hslOrigin);
  const result = await openPackContent(target, {
    ...options,
    externalLine: "Ranking abierto en High Score League.",
    externalSummary: "Ranking abierto en la web.",
  });

  return {
    action: "open-ranking",
    ...result,
    state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
  };
}

function getBridgeState(config, activePack = null) {
  const hasExternalMame = Boolean(config.mame?.executablePath && config.mame?.workingDir);
  const packOpened = config.configSource === "pack abierto";
  const duplicateGroup = config.configSource === "pack duplicado";
  const packIssue = config.configSource === "pack con errores";
  const mode = packOpened
    ? "opened-pack"
    : duplicateGroup
      ? "duplicate-group"
      : packIssue
        ? "pack-issue"
    : config.configExists && !config.packLoaded && hasExternalMame
    ? "dev-bridge"
    : config.packLoaded
      ? "pack"
      : "defaults";

  return {
    activePackName: config.pack?.packId || config.pack?.gameId || null,
    activeInstanceKey: activePack?.instanceKey || null,
    configSource: config.configSource,
    contractStatus: config.pack?.contractStatus || null,
    deprecated: Boolean(config.pack?.deprecated),
    devBridge: mode === "dev-bridge",
    mode,
    packOpened,
    duplicateGroup,
    packIssue,
    packRemembered: Boolean(activeOpenedPack?.remembered),
    packLoaded: config.packLoaded,
    packMetadataLoaded: Boolean(config.pack?.metadataLoaded),
    packMetadataWarnings: config.pack?.metadataWarnings || [],
    packPath: config.packPath,
    packRoot: config.packRoot || null,
    pluginName: config.mame?.pluginName || "hsl-score",
    scopedQueue: config.eventsSource === "scoped-user-pack",
    sharedMameRuntimeAvailable: Boolean(config.sharedMameRuntime?.available),
    sharedMameRuntimeConfigured: Boolean(config.sharedMameRuntime?.configured),
    webBaseUrl: config.webBaseUrl || null,
    workingDir: config.mame?.workingDir || null,
  };
}

function getEmptyBridgeState(library) {
  return {
    activeInstanceKey: null,
    activePackName: null,
    configSource: null,
    contractStatus: null,
    deprecated: false,
    devBridge: false,
    duplicateGroup: false,
    mode: library.status === "missing" || library.status === "inaccessible"
      ? "library-unavailable"
      : "no-selection",
    packIssue: false,
    packLoaded: false,
    packMetadataLoaded: false,
    packMetadataWarnings: [],
    packOpened: false,
    packPath: null,
    packRemembered: false,
    packRoot: null,
    pluginName: null,
    scopedQueue: false,
    sharedMameRuntimeAvailable: false,
    sharedMameRuntimeConfigured: false,
    webBaseUrl: null,
    workingDir: null,
  };
}

async function getLauncherState(options = {}) {
  const context = await getLauncherContext({
    config: options.config || null,
    deferRemoteMembership: options.deferRemoteMembership === true,
  });

  if (options.attemptAutoSync) {
    const result = await runAutoSyncIfEligible(context);

    if (result.attempted) {
      return stateFromContext(await getLauncherContext({ config: options.config || null }));
    }
  }

  return stateFromContext(context);
}

function stateOptionsForAction(options = {}, config = null) {
  const stateConfig = options.config || options.rememberConfig || config;
  return stateConfig ? { config: stateConfig } : {};
}

async function recheckSeasonMembership() {
  return {
    action: "check-membership",
    lines: ["Comprobacion de temporada actualizada."],
    ok: true,
    summary: "Comprobacion de temporada actualizada.",
    state: await getLauncherState(),
  };
}

async function withFreshState(action, fn) {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const captured = await captureConsoleAsync(() => fn(config));
  const exitCode = Number.isInteger(captured.result) ? captured.result : captured.exitCode;

  return {
    action,
    exitCode,
    lines: captured.lines,
    ok: exitCode === 0,
    result: captured.result || null,
    state: await getLauncherState(),
  };
}

function readinessBlockedResponse(action, readiness, capability) {
  const blocked = capability === "competition"
    ? readiness?.canPlayCompetition === false
    : readiness?.canPractice === false;

  if (!blocked) {
    return null;
  }

  const summary = capability === "competition"
    ? "No se puede jugar competicion con este pack."
    : "No se puede practicar con este pack.";

  return {
    action,
    lines: [
      readiness?.message || summary,
      ...(readiness?.blockers || []).filter((item) => item !== readiness?.message),
    ],
    ok: false,
    summary,
  };
}

async function runDiagnose(options = {}) {
  if (!options.config) {
    await ensureRememberedPackLoaded();
  }

  const config = options.config || getEffectiveConfig();
  const report = await buildDiagnoseReport(config);
  const state = options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config));
  const remoteDiagnostics = remoteDiagnosticsProvider?.() || null;
  const directory = state?.library?.directory;
  const remoteConfig = state?.remoteConfiguration || config.remoteConfiguration || null;

  if (remoteConfig) {
    const remoteConfigurationEntry = {
      level: remoteConfig.status === "configured" ? "OK" : "WARN",
      message: `configuracion remota HSL: ${remoteConfig.status}`,
      detail: remoteConfig,
    };
    report.sections.remoteConfiguration = [remoteConfigurationEntry];
    if (remoteConfigurationEntry.level === "WARN") report.warnings.push(remoteConfigurationEntry);
  }

  if (remoteDiagnostics) {
    if (remoteDiagnostics.securityPolicy) {
      report.sections.securityPolicy = [{
        level: "OK",
        message: "politica de seguridad del renderer Electron",
        detail: remoteDiagnostics.securityPolicy,
      }];
    }
    const connectivityStatus = remoteDiagnostics.connectivity?.displayStatus || "unknown";
    const connectivityEntry = {
      level: connectivityStatus === "connected" ? "OK" : connectivityStatus === "offline" ? "WARN" : "INFO",
      message: `conectividad HSL: ${connectivityStatus}`,
      detail: remoteDiagnostics.connectivity || null,
    };
    report.sections.connectivity = [connectivityEntry];
    report.sections.ranking = [{
      level: "INFO",
      message: "capacidades remotas de ranking",
      detail: remoteDiagnostics.ranking || null,
    }];
    report.sections.autoSubmit = [{
      level: remoteDiagnostics.autoSubmit?.failed > 0 ? "WARN" : "INFO",
      message: "autoenvio de puntuaciones pendientes",
      detail: remoteDiagnostics.autoSubmit || null,
    }];

    if (connectivityEntry.level === "WARN") {
      report.warnings.push(connectivityEntry);
    }
  }

  if (directory?.configured && !directory.available) {
    if (directory.classification === "unsupported-layout") {
      report.recommendations.push("Mueve cada pack a una subcarpeta directa de la raíz de biblioteca.");
    } else if (["pack-root", "inside-pack"].includes(directory.classification)) {
      report.recommendations.push("Elige la carpeta que contiene todos tus packs, no un pack ni una carpeta interna.");
    } else {
      report.recommendations.push("Recupera la unidad o cambia la ubicación de la biblioteca de packs.");
    }
  }

  const activeInstanceKey = state?.selection?.activeInstanceKey || null;
  const activeBelongsToLibrary = !activeInstanceKey || state.library.packs.some(
    (pack) => pack.instanceKey === activeInstanceKey
  );

  if (!activeBelongsToLibrary) {
    report.recommendations.push("Active pack does not belong to current library.");
  }

  const summary = summarizeDiagnoseReport(report);
  const source = config.configSource === "pack abierto" ? "pack abierto" : "configuración local";

  let diagnosticLog = null;
  let diagnosticLogWarning = null;

  try {
    diagnosticLog = await writeDiagnosticReport(config, report, {
      remoteDiagnostics,
      source,
      state: state && remoteDiagnostics
        ? {
            ...state,
            autoSubmitDiagnostics: remoteDiagnostics.autoSubmit,
            connectivity: remoteDiagnostics.connectivity,
            rankingCapabilities: remoteDiagnostics.ranking,
          }
        : state,
      summary,
    }, options.diagnosticLogOptions || {});
  } catch (error) {
    diagnosticLogWarning = normalizeMessage(error);
  }

  return {
    action: "diagnose",
    lines: [
      ...(diagnosticLog
        ? [`Informe guardado en diagnostics: ${diagnosticLog.filePath}`]
        : ["No se pudo guardar el informe de diagnostico."]),
      ...(diagnosticLogWarning ? [`Detalle: ${diagnosticLogWarning}`] : []),
      `Origen: ${source}.`,
      `Diagnóstico: ${report.errors.length} errores, ${report.warnings.length} advertencias.`,
      ...[...new Set(report.recommendations)].map((item) => `Recomendación: ${item}`),
    ],
    diagnosticLog,
    diagnosticLogWarning,
    ok: report.errors.length === 0,
    report: summary,
    state,
  };
}

async function playCompetition() {
  const context = await getLauncherContext();
  const { baseConfig, membership, session } = context;

  if (!session.hasSession) {
    return {
      action: "play-competition",
      lines: ["Inicia sesion para jugar en competicion y guardar puntuaciones en tu cola local."],
      ok: false,
      summary: "Inicia sesion para jugar en competicion.",
      state: await getLauncherState(),
    };
  }

  if (shouldBlockCompetition(membership)) {
    return {
      action: "play-competition",
      lines: [membership.message],
      ok: false,
      summary: membership.message,
      state: await getLauncherState(),
    };
  }

  const scoped = context.scoped;

  if (!scoped.scope) {
    return {
      action: "play-competition",
      lines: [scoped.reason || "No se pudo preparar la cola local de esta cuenta."],
      ok: false,
      summary: "No se pudo preparar la cola local.",
      state: await getLauncherState(),
    };
  }

  const readinessQueue = await getQueueState(scoped.config);
  const readiness = evaluatePackReadiness({
    autoSync: autoSyncState,
    config: scoped.config,
    membership,
    queue: readinessQueue,
    scope: scoped.scope,
    session,
  });
  const readinessBlock = readinessBlockedResponse("play-competition", readiness, "competition");

  if (readinessBlock) {
    return {
      ...readinessBlock,
      state: await getLauncherState(),
    };
  }

  const isPackV2 = baseConfig.pack?.packVersion === 2 || baseConfig.pack?.contract?.version === 2;
  let launchConfig = baseConfig;
  let stagingPendingDir = baseConfig.eventsPendingDirAbs;
  let snapshot = await listPendingFileSnapshot(stagingPendingDir);
  let preparedRun = null;

  if (isPackV2) {
    try {
      preparedRun = await prepareV2CompetitionRun(baseConfig, scoped.scope);
      launchConfig = preparedRun.config;
      stagingPendingDir = preparedRun.stagingPendingDir;
      snapshot = new Map();
    } catch (error) {
      return {
        action: "play-competition",
        lines: [normalizeMessage(error)],
        ok: false,
        summary: "No se pudo preparar la captura competitiva.",
        state: await getLauncherState(),
      };
    }
  }

  const startedAtMs = Date.now();
  const captured = await captureConsoleAsync(() => (
    isPackV2
      ? launchMameDetailed(launchConfig, baseConfig.pack.rom, "competition")
      : launchMame(launchConfig, baseConfig.pack.rom, "competition")
  ));
  const exitCode = Number.isInteger(captured.result) ? captured.result : captured.result?.exitCode ?? captured.exitCode;
  const mameOutputLines = summarizeMameOutput(captured.result);
  const adoption = await adoptNewStagingEvents(
    stagingPendingDir,
    scoped.config.eventsPendingDirAbs,
    snapshot,
    startedAtMs
  );
  const legacyLine = !isPackV2 && snapshot.size > 0
    ? `Hay ${snapshot.size} capturas antiguas sin asignar en staging; no se importaron automaticamente.`
    : null;
  const savedLocallyLine = adoption.adopted.length > 0 && (membership.status === "unknown" || membership.status === "error")
    ? "Puntuacion guardada localmente. Se sincronizara cuando pueda comprobarse la temporada."
    : null;

  return {
    action: "play-competition",
    adoption,
    exitCode,
    lines: [
      ...(membership.status === "unknown" || membership.status === "error"
        ? [membership.message]
        : []),
      ...(preparedRun
        ? [`Captura v2 preparada: ${preparedRun.runId}.`]
        : []),
      ...captured.lines,
      ...mameOutputLines,
      ...(adoption.adopted.length > 0
        ? [`${adoption.adopted.length} captura(s) nueva(s) movida(s) a la cola de esta cuenta y pack.`]
        : ["No se detectaron capturas nuevas para adoptar."]),
      ...(savedLocallyLine ? [savedLocallyLine] : []),
      ...(legacyLine ? [legacyLine] : []),
    ],
    ok: exitCode === 0,
    result: captured.result || null,
    state: await getLauncherState(),
  };
}

async function playPractice() {
  await ensureRememberedPackLoaded();
  const context = await getLauncherContext();
  const autoSync = getAutoSyncDisplayState({
    autoSyncInProgress,
    membership: context.membership,
    queue: context.queue,
    scope: context.scoped.scope,
    session: context.session,
  }, autoSyncState);
  const readiness = evaluatePackReadiness({
    autoSync,
    config: context.config,
    membership: context.membership,
    queue: context.queue,
    scope: context.scoped.scope,
    session: context.session,
  });
  const readinessBlock = readinessBlockedResponse("practice", readiness, "practice");

  if (readinessBlock) {
    return {
      ...readinessBlock,
      state: await getLauncherState(),
    };
  }

  const captured = await captureConsoleAsync(() => launchMame(context.config, context.config.pack.rom, "practice"));
  const exitCode = Number.isInteger(captured.result) ? captured.result : captured.exitCode;

  return {
    action: "practice",
    exitCode,
    lines: captured.lines,
    ok: exitCode === 0,
    result: captured.result || null,
    state: await getLauncherState(),
  };
}

async function restoreFailedSubmission(filename) {
  await ensureRememberedPackLoaded();
  const baseConfig = getEffectiveConfig();
  const session = await getAuthState(baseConfig, { deferRemote: true });

  if (!session.hasSession) {
    return {
      action: "restore-failed",
      lines: ["Inicia sesion para restaurar puntuaciones de esta cuenta."],
      ok: false,
      summary: "Inicia sesion para restaurar puntuaciones.",
      state: await getLauncherState(),
    };
  }

  const scoped = await getScopedGuiConfig(baseConfig, session);

  if (!scoped.scope) {
    return {
      action: "restore-failed",
      lines: [scoped.reason || "No se pudo preparar la cola local de esta cuenta."],
      ok: false,
      summary: "No se pudo preparar la cola local.",
      state: await getLauncherState(),
    };
  }

  try {
    const result = await restoreBoxToPending(scoped.config, "failed", filename);

    return {
      action: "restore-failed",
      lines: [
        "Puntuacion restaurada a pendientes.",
        "Se enviara automaticamente cuando la cuenta y la conexion vuelvan a estar disponibles.",
      ],
      ok: true,
      restored: result,
      summary: "Puntuacion restaurada a pendientes.",
      state: await getLauncherState(),
    };
  } catch (error) {
    return {
      action: "restore-failed",
      lines: [normalizeMessage(error)],
      ok: false,
      summary: "No se pudo restaurar la puntuacion.",
      state: await getLauncherState(),
    };
  }
}

/**
 * @deprecated Temporary dev-bridge action for packVersion 1. The player-facing
 * replacement is automatic isolated plugin/adapter preparation for v2.
 */
async function syncPlugin() {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();

  if (config.configSource === "pack abierto") {
    return {
      action: "sync-plugin",
      lines: ["Sync plugin está disponible solo para el modo desarrollo puente."],
      ok: false,
      summary: "Sync plugin está disponible solo para desarrollo.",
      state: await getLauncherState(),
    };
  }

  return withFreshState("sync-plugin", async (config) => {
    const result = await syncPluginToPack(config);
    printSyncPluginResult(result);
    return {
      copiedCount: result.copied.length,
      targetDir: result.targetDir,
    };
  });
}

async function loginWithPassword(credentials = {}) {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const result = await signInWithPassword(config, {
    email: credentials.email,
    password: credentials.password,
  });

  return {
    action: "login",
    lines: [result.message],
    ok: result.ok,
    summary: result.message,
    state: await getLauncherState(),
  };
}

async function logoutSession() {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const result = await logoutLocal(config, { forgetAccount: true, reason: "gui-logout" });

  return {
    action: "logout",
    lines: [result.message, "Cuenta olvidada en este dispositivo.", "Las puntuaciones locales no se han borrado."],
    ok: result.ok,
    summary: "Sesión cerrada.",
    state: await getLauncherState(),
  };
}

async function switchKnownAccountFromGui(userId, options = {}) {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const accounts = await readKnownAccounts(config);
  const account = accounts.accounts.find((item) => item.userId === userId);

  if (!account) {
    return {
      action: "switch-account",
      lines: ["No se encontro esa cuenta recordada."],
      ok: false,
      summary: "No se encontro esa cuenta recordada.",
      state: await getLauncherState(),
    };
  }

  const resolved = await accountSessionCoordinator.resolve(account, config, {
    active: true,
    connected: options.connected === true,
  });

  if (!isSessionLocallyAvailable(resolved.sessionResult) || requiresSessionLogin(resolved.sessionResult) || !resolved.storedSession) {
    return {
      action: "switch-account-login-required",
      email: account.email,
      lines: ["No hay una sesion guardada para esta cuenta. Inicia sesion de nuevo."],
      ok: false,
      requiresLogin: true,
      summary: "Inicia sesion de nuevo para esta cuenta.",
      state: await getLauncherState(),
    };
  }

  try {
    await sessionRepository(config).setActive(account.userId);

    return {
      action: "switch-account",
      lines: [
        `Cuenta activa: ${resolved.storedSession.user?.email || account.email || account.userId}.`,
        "Cambiar cuenta no mezcla puntuaciones locales.",
      ],
      ok: true,
      summary: "Cuenta cambiada.",
      state: await getLauncherState(),
    };
  } catch (error) {
    return {
      action: "switch-account-login-required",
      email: account.email,
      lines: [
        "No se pudo activar esta cuenta. Su sesion y sus puntuaciones se conservan.",
        normalizeMessage(error),
      ],
      ok: false,
      requiresLogin: true,
      summary: "No se pudo activar esta cuenta.",
      state: await getLauncherState(),
    };
  }
}

async function removeKnownAccountFromGui(userId) {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const session = await getAuthState(config, { deferRemote: true });
  const result = await sessionRepository(config).remove(userId, {
    forgetAccount: true,
    reason: "remove-account",
  });

  if (session.hasSession && session.userId === userId) {

    return {
      action: "remove-known-account",
      lines: ["Cuenta olvidada en este dispositivo.", "La sesión activa se ha cerrado.", "Las puntuaciones locales no se han borrado."],
      ok: result.removed,
      summary: result.removed ? "Cuenta olvidada." : "No se encontró esa cuenta recordada.",
      state: await getLauncherState(),
    };
  }

  const summary = result.removed
    ? "Cuenta olvidada en este dispositivo. Las puntuaciones locales no se han borrado."
    : "No se encontró esa cuenta recordada.";

  return {
    action: "remove-known-account",
    lines: [summary, "La cuenta recordada se ha quitado solo de este launcher."],
    ok: result.removed,
    summary,
    state: await getLauncherState(),
  };
}

async function getAuthStateForGui() {
  await ensureRememberedPackLoaded();
  return getAuthState(getEffectiveConfig(), { deferRemote: true });
}

async function cancelOpenPack() {
  return {
    action: "open-pack",
    canceled: true,
    lines: ["No se seleccionó ningún pack."],
    ok: true,
    summary: "No se seleccionó ningún pack.",
    state: await getLauncherState(),
  };
}

async function activatePackDirectory(packDir, options = {}) {
  const result = readPackForGui(packDir);
  const action = options.action || "open-pack";

  if (!result.ok) {
    return {
      action,
      code: result.code,
      lines: result.errors,
      ok: false,
      summary: result.code === "missing_pack_json"
        ? "No encuentro pack.json en esta carpeta. Elige la carpeta raiz del pack o crea un pack.json a partir del ejemplo de desarrollo."
        : "El pack no parece valido para High Score League.",
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options)),
    };
  }

  activeOpenedPack = {
    openedAt: new Date().toISOString(),
    pack: result.pack,
    remembered: false,
  };
  activeLibraryIssue = null;
  recentPackNotices = [];
  let recentWriteWarning = null;

  try {
    await writeLastOpenedPack(options.rememberConfig || loadRuntimeConfig(), result.pack.packRoot);
  } catch (error) {
    recentWriteWarning = `No se pudo recordar este pack para el proximo inicio: ${normalizeMessage(error)}`;
  }

  return {
    action,
    lines: [
      `Pack abierto correctamente: ${result.pack.packId || result.pack.gameId}.`,
      "Cambiar de pack no borra puntuaciones locales.",
      ...(recentWriteWarning ? [recentWriteWarning] : []),
    ],
    ok: true,
    pack: {
      gameId: result.pack.gameId,
      packId: result.pack.packId || null,
      packRoot: result.pack.packRoot,
      rom: result.pack.rom,
      weekId: result.pack.weekId,
    },
    summary: options.summary || "Pack abierto correctamente.",
    state: options.includeState === false ? null : await getLauncherState({
      ...stateOptionsForAction(options),
    }),
  };
}

async function openPackDirectory(packDir) {
  return activatePackDirectory(packDir);
}

async function cancelChoosePackDirectory(options = {}) {
  const config = options.config || loadRuntimeConfig();

  return {
    action: "choose-pack-directory",
    canceled: true,
    lines: ["No se selecciono ningun directorio de packs."],
    ok: true,
    summary: "No se selecciono ningun directorio de packs.",
    state: await getLauncherState(stateOptionsForAction(options, config)),
  };
}

async function choosePackDirectoryFromGui(directoryPath, options = {}) {
  const config = options.config || loadRuntimeConfig();
  const result = await setPackDirectory(config, directoryPath, options);

  if (result.ok) {
    clearActiveLibrarySelection();
  }

  return {
    action: "choose-pack-directory",
    lines: [
      result.summary,
      "No se han copiado, movido ni borrado packs.",
      "Cambiar directorio no borra puntuaciones locales.",
    ],
    ok: result.ok,
    result,
    summary: result.summary,
    state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
  };
}

async function cancelImportPack() {
  return {
    action: "import-pack",
    canceled: true,
    lines: ["No se seleccionó ningún pack."],
    ok: true,
    summary: "No se seleccionó ningún pack.",
    state: await getLauncherState(),
  };
}

async function activateImportedPack(imported, config, options = {}) {
  const library = await scanPackLibrary(config);
  const importedPack = library.packs.find((pack) => normalizedPath(pack.packDir) === normalizedPath(imported.packDir));
  const activation = importedPack
    ? await activateLibraryPack(importedPack.id, { config, includeState: false })
    : { ok: false };
  const state = await getLauncherState(stateOptionsForAction(options, config));

  return {
    action: "import-pack",
    alreadyInstalled: imported.alreadyInstalled,
    imported: imported.imported,
    kind: imported.kind,
    lines: [
      imported.summary,
      imported.alreadyInstalled ? "Biblioteca reescaneada." : `Instalado en: ${imported.packDir}`,
      ...(activation.ok ? ["Pack activado desde biblioteca."] : ["Pack importado, pero no se pudo activar automaticamente."]),
      ...(imported.warnings || []),
    ],
    ok: true,
    pack: {
      gameId: imported.pack.gameId,
      packId: imported.pack.packId || null,
      packRoot: imported.packDir,
      rom: imported.pack.rom,
      weekId: imported.pack.weekId,
    },
    packDir: imported.packDir,
    summary: imported.summary,
    state: options.includeState === false ? null : state,
  };
}

function importPackErrorResponse(error, options, config) {
  const isKnown = error instanceof PackImportError;
  const summary = isKnown
    ? error.message
    : "No se pudo completar la importacion. No se ha instalado nada.";

  return {
    action: "import-pack",
    code: isKnown ? error.code : "unexpected_import_error",
    lines: [
      summary,
      "No se ha instalado nada.",
      ...(isKnown ? error.details || [] : [normalizeMessage(error)]),
    ],
    ok: false,
    summary,
    state: options.includeState === false ? null : getLauncherState(stateOptionsForAction(options, config)),
  };
}

async function importPackFromZipForGui(zipPath, options = {}) {
  const config = options.config || loadRuntimeConfig();

  try {
    const imported = await importPackZip(zipPath, config, options.importOptions || {});
    return activateImportedPack(imported, config, options);
  } catch (error) {
    const response = importPackErrorResponse(error, options, config);
    response.state = await response.state;
    return response;
  }
}

async function importPackFromFolderForGui(folderPath, options = {}) {
  const config = options.config || loadRuntimeConfig();

  try {
    const imported = await importPackFolder(folderPath, config, options.importOptions || {});
    return activateImportedPack(imported, config, options);
  } catch (error) {
    const response = importPackErrorResponse(error, options, config);
    response.state = await response.state;
    return response;
  }
}

async function chooseSharedMameRuntimeFromGui(mameExecutablePath, options = {}) {
  const config = options.config || loadRuntimeConfig();

  try {
    const runtime = await writeSharedMameRuntime(config, mameExecutablePath, options);
    const summary = runtime.available
      ? "Runtime MAME compartido configurado."
      : "Runtime MAME guardado, pero mame.exe no esta disponible.";

    return {
      action: "choose-shared-mame-runtime",
      lines: [
        summary,
        ...(runtime.warnings || []),
        ...(runtime.errors || []),
      ],
      ok: runtime.available,
      runtime,
      summary,
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
    };
  } catch (error) {
    return {
      action: "choose-shared-mame-runtime",
      lines: [normalizeMessage(error)],
      ok: false,
      summary: "No se pudo configurar MAME compartido.",
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
    };
  }
}

async function cancelChooseSharedMameRuntime() {
  return {
    action: "choose-shared-mame-runtime",
    canceled: true,
    lines: ["No se selecciono mame.exe."],
    ok: true,
    summary: "No se selecciono mame.exe.",
    state: await getLauncherState(),
  };
}

async function openSharedMameRuntimeDirectory(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const runtime = config.sharedMameRuntime;

  if (!runtime?.mameExecutablePath) {
    return {
      action: "open-shared-mame-runtime",
      lines: ["Todavia no has configurado MAME compartido."],
      ok: false,
      summary: "Todavia no has configurado MAME compartido.",
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
    };
  }

  const runtimeDir = path.dirname(runtime.mameExecutablePath);

  try {
    const result = await (options.openPathImpl || (() => Promise.resolve("")))(runtimeDir);

    if (typeof result === "string" && result.trim() !== "") {
      return {
        action: "open-shared-mame-runtime",
        lines: [result],
        ok: false,
        summary: "No se pudo abrir la carpeta de MAME.",
        state: options.includeState === false ? null : await getLauncherState(),
      };
    }
  } catch (error) {
    return {
      action: "open-shared-mame-runtime",
      lines: [normalizeMessage(error)],
      ok: false,
      summary: "No se pudo abrir la carpeta de MAME.",
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
    };
  }

  return {
    action: "open-shared-mame-runtime",
    lines: [`Carpeta MAME abierta: ${runtimeDir}`],
    ok: true,
    summary: "Carpeta MAME abierta.",
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

async function openConfiguredPackDirectory(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const directory = await readPackDirectory(config);

  if (!directory.directoryPath) {
    return {
      action: "open-pack-directory",
      lines: ["Todavia no has elegido un directorio de packs."],
      ok: false,
      summary: "Todavia no has elegido un directorio de packs.",
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
    };
  }

  if (!directory.exists) {
    return {
      action: "open-pack-directory",
      lines: ["No encuentro el directorio de packs. Puedes cambiarlo o volver a crearlo."],
      ok: false,
      summary: "No encuentro el directorio de packs.",
      state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
    };
  }

  const openPath = options.openPathImpl;

  if (openPath) {
    const result = await openPath(directory.directoryPath);

    if (result) {
      return {
        action: "open-pack-directory",
        lines: [result],
        ok: false,
        summary: "No se pudo abrir el directorio de packs.",
        state: options.includeState === false ? null : await getLauncherState(),
      };
    }
  }

  return {
    action: "open-pack-directory",
    lines: [`Directorio abierto: ${directory.directoryPath}`],
    ok: true,
    summary: "Directorio de packs abierto.",
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

async function rescanPackDirectory(options = {}) {
  const config = options.config || loadRuntimeConfig();
  const library = await scanPackLibrary(config);

  const unavailable = library.directory?.configured && !library.directory?.available;
  const summary = unavailable
    ? library.directory.classification === "unsupported-layout"
      ? "Los packs deben estar en subcarpetas directas de la biblioteca."
      : ["pack-root", "inside-pack"].includes(library.directory.classification)
        ? "La carpeta configurada no es una raíz de biblioteca válida."
        : library.directory.reason === "missing"
          ? "No se encuentra el directorio de packs."
          : "No puedo acceder al directorio de packs."
    : "Biblioteca reescaneada.";

  return {
    action: "rescan-pack-directory",
    lines: [summary],
    ok: true,
    summary,
    state: options.includeState === false ? null : await getLauncherState(stateOptionsForAction(options, config)),
  };
}

async function setLibraryPreferencesFromGui(patch = {}, options = {}) {
  if (!options.config) {
    await ensureRememberedPackLoaded();
  }

  const config = options.config || loadRuntimeConfig();
  const session = options.session || await getAuthState(config, { deferRemote: true });
  const preferences = await writeLibraryPreferences(config, session, patch, options);

  return {
    action: "set-library-preferences",
    ok: true,
    preferences,
    state: options.includeState === false ? null : await getLauncherState(),
    summary: "Preferencias de biblioteca guardadas.",
  };
}

async function toggleLibraryFavoriteFromGui(packKey, options = {}) {
  if (!options.config) {
    await ensureRememberedPackLoaded();
  }

  const config = options.config || loadRuntimeConfig();
  const session = options.session || await getAuthState(config, { deferRemote: true });

  if (!session.hasSession) {
    return {
      action: "toggle-library-favorite",
      favorites: {
        disabled: true,
        favorites: {},
        filePath: null,
        scope: "disabled",
        warnings: ["Inicia sesion para marcar favoritos."],
      },
      ok: false,
      state: options.includeState === false ? null : await getLauncherState(),
      summary: "Inicia sesion para marcar favoritos.",
    };
  }

  const library = await scanPackLibrary(config);
  const conflicted = library.packs.find((pack) => pack.duplicatePackId && pack.favoriteKey === packKey);

  if (conflicted) {
    return {
      action: "toggle-library-favorite",
      favorites: {
        disabled: true,
        favorites: {},
        filePath: null,
        scope: "disabled",
        warnings: ["Hay otro pack con el mismo packId. Cambia el packId o elimina el duplicado."],
      },
      ok: false,
      state: options.includeState === false ? null : await getLauncherState(),
      summary: "No se puede marcar favorito en un pack duplicado.",
    };
  }

  const favorites = await toggleLibraryFavorite(config, packKey, {
    ...options,
    session,
  });

  return {
    action: "toggle-library-favorite",
    favorites,
    ok: true,
    state: options.includeState === false ? null : await getLauncherState(),
    summary: "Favorito actualizado.",
  };
}

async function activateLibraryPack(packId, options = {}) {
  const config = options.config || loadRuntimeConfig();
  const library = await scanPackLibrary(config);
  const pack = library.packs.find((item) => item.id === packId);

  if (!pack) {
    return {
      action: "use-library-pack",
      lines: ["No se encontro ese pack en la biblioteca."],
      ok: false,
      summary: "No se encontro ese pack en la biblioteca.",
      state: options.includeState === false ? null : await getLauncherState({
        ...stateOptionsForAction(options, config),
        deferRemoteMembership: options.deferRemoteMembership === true,
      }),
    };
  }

  materializeLibrarySelection(pack, library.directory.path, "user");
  recentPackNotices = [];
  let rememberWarning = null;

  try {
    await writeLibrarySelection(config, library.directory.path, pack);
    await writeLastOpenedPack(config, pack.packDir);
  } catch (error) {
    rememberWarning = `No se pudo recordar la selección: ${normalizeMessage(error)}`;
  }

  const hasIssues = pack.status === "error" || pack.duplicatePackId;

  return {
    action: "use-library-pack",
    lines: [
      hasIssues ? "Pack seleccionado para revisión." : "Pack activado desde biblioteca.",
      ...(pack.errors || []),
      ...(rememberWarning ? [rememberWarning] : []),
    ],
    ok: true,
    pack: {
      instanceKey: pack.instanceKey,
      packId: pack.packId || null,
      packRoot: pack.packDir,
    },
    summary: hasIssues ? "Pack con errores seleccionado." : "Pack activado desde biblioteca.",
    state: options.includeState === false ? null : await getLauncherState({
      ...stateOptionsForAction(options, config),
      deferRemoteMembership: options.deferRemoteMembership === true,
    }),
  };
}

module.exports = {
  adoptNewStagingEvents,
  activateLibraryPack,
  activatePackDirectory,
  cancelAccountSessionOperations,
  cancelChoosePackDirectory,
  cancelChooseSharedMameRuntime,
  cancelImportPack,
  cancelOpenPack,
  chooseSharedMameRuntimeFromGui,
  choosePackDirectoryFromGui,
  classifyFailureReason,
  deriveOpenedPackConfig,
  drainAccountSessionOperations,
  eventResultToQueueItem,
  getAuthStateForGui,
  getPendingAutoSubmitDiagnostics,
  getPendingAutoSubmitContext,
  getPendingAutoSubmitContexts,
  getAccountSessionDiagnostics,
  getRemoteBootstrapState,
  getLauncherState,
  importPackFromFolderForGui,
  importPackFromZipForGui,
  invalidateInteractiveRemoteOperations,
  cancelPendingAutoSubmit,
  loginWithPassword,
  listPendingFileSnapshot,
  logoutSession,
  migrateRememberedSessionsForGui,
  openPackDirectory,
  openPackManual,
  openPackRanking,
  openSharedMameRuntimeDirectory,
  playCompetition,
  playPractice,
  readPackForGui,
  recheckSeasonMembership,
  removeKnownAccountFromGui,
  openConfiguredPackDirectory,
  rescanPackDirectory,
  restoreFailedSubmission,
  resolveRememberedPack,
  resetAutoSyncStateForTests,
  setRemoteDiagnosticsProvider,
  setRemoteOperationSignalProvider,
  shutdownAccountSessions,
  runAutoSyncIfEligible,
  runPendingAutoSubmit,
  runPendingAutoSubmitForAccounts,
  runDiagnose,
  setLibraryPreferencesFromGui,
  summarizeDiagnoseReport,
  switchKnownAccountFromGui,
  syncPlugin,
  toggleLibraryFavoriteFromGui,
};
