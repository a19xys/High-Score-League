const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  clearActiveAccount,
  deleteRememberedSession,
  listSavedSessionUserIds,
  readKnownAccounts,
  readRememberedSession,
  rememberSessionAccount,
  removeKnownAccount,
  saveRememberedSession,
  toSafeAccountsState,
} = require("../src/account-store");
const { loadConfig } = require("../src/config");
const {
  emptyAutoSyncState,
  getAutoSyncDisplayState,
  shouldAutoSync,
  summarizeAutoSyncAttempt,
} = require("../src/auto-sync");
const {
  getAuthState,
  isSessionExpiringSoon,
  logoutLocal,
  readSession,
  refreshStoredSession,
  saveSession,
  signInWithPassword,
} = require("../src/auth");
const { buildDiagnoseReport } = require("../src/diagnose");
const { listJsonFiles, readEventFile } = require("../src/event-files");
const { listSupportedGames } = require("../src/games");
const { launchMame } = require("../src/mame-launcher");
const { evaluatePackReadiness } = require("../src/pack-readiness");
const { readPackDirectory, setPackDirectory } = require("../src/pack-directory");
const { scanPackLibrary } = require("../src/pack-library");
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
const { loadPackFromDir, resolvePackMamePaths } = require("../src/pack");
const { readRecentPackState, writeLastOpenedPack } = require("../src/recent-packs");
const { writeSharedMameRuntime } = require("../src/shared-mame-runtime");
const { printSyncPluginResult, syncPluginToPack } = require("../src/dev-sync-plugin");
const { submitAll } = require("../src/submission-service");
const { moveFileSafe, readFailureNote, restoreBoxToPending } = require("../src/file-queue");
const { applyScopedQueue, ensureScopedQueue } = require("../src/scoped-queue");
const {
  checkSeasonMembership,
  shouldBlockCompetition,
  shouldBlockSubmit,
} = require("../src/season-membership");

let activeOpenedPack = null;
let recentPackLoadAttempted = false;
let recentPackNotices = [];
let autoSyncInProgress = false;
let manualSyncInProgress = false;
let autoSyncState = emptyAutoSyncState();

function loadRuntimeConfig() {
  return loadConfig();
}

function getPackPluginName(pack) {
  return pack?.mame?.pluginName || pack?.capture?.pluginName || pack?.contract?.capture?.pluginName || pack?.plugin?.name || "hsl-score";
}

function deriveOpenedPackConfig(baseConfig, pack) {
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
    mame,
    mameSource: requiresSharedMameRuntime ? "shared-runtime-pending" : "opened-pack",
    pack,
    packErrors: pack.errors || [],
    packLoaded: true,
    packPath: pack.packPath,
    packRoot: pack.packRoot,
    requiresSharedMameRuntime,
    webBaseUrl: pack.webBaseUrl || baseConfig.webBaseUrl,
  };
}

function getEffectiveConfig() {
  const baseConfig = loadRuntimeConfig();

  if (!activeOpenedPack) {
    return baseConfig;
  }

  return deriveOpenedPackConfig(baseConfig, activeOpenedPack.pack);
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
  if (activeOpenedPack || recentPackLoadAttempted) {
    return;
  }

  recentPackLoadAttempted = true;
  const remembered = await resolveRememberedPack(loadRuntimeConfig());

  if (remembered.notice) {
    recentPackNotices = [remembered.notice];
  }

  if (remembered.ok) {
    activeOpenedPack = {
      openedAt: new Date().toISOString(),
      pack: remembered.pack,
      remembered: true,
    };
  }
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

async function getLauncherContext() {
  await ensureRememberedPackLoaded();
  const baseConfig = getEffectiveConfig();
  const session = await getAuthState(baseConfig);
  const accountsStore = session.hasSession
    ? await rememberSessionAccount(baseConfig, session)
    : await readKnownAccounts(baseConfig);
  const membership = await checkSeasonMembership(baseConfig, session);
  const scoped = await getScopedGuiConfig(baseConfig, session);
  const queue = scoped.scope
    ? await getQueueState(scoped.config)
    : getEmptyQueueState(baseConfig, scoped.reason);

  return {
    accountsStore,
    baseConfig,
    config: scoped.config,
    membership,
    queue,
    scoped,
    session,
  };
}

async function stateFromContext(context) {
  const { accountsStore, baseConfig, config, membership, queue, scoped, session } = context;
  const autoSync = getAutoSyncDisplayState({
    autoSyncInProgress,
    membership,
    queue,
    scope: scoped.scope,
    session,
  }, autoSyncState);
  const savedSessionUserIds = await listSavedSessionUserIds(baseConfig, accountsStore.accounts);
  const [library, libraryPreferences, libraryFavorites] = await Promise.all([
    scanPackLibrary(baseConfig),
    readLibraryPreferences(baseConfig, session),
    readLibraryFavorites(baseConfig, session),
  ]);
  const favoriteMap = libraryFavorites.favorites || {};
  const libraryState = {
    ...library,
    favorites: {
      count: Object.keys(favoriteMap).length,
      filePath: libraryFavorites.filePath,
      warnings: libraryFavorites.warnings || [],
    },
    packs: library.packs.map((pack) => ({
      ...pack,
      favorite: Boolean(favoriteMap[pack.favoriteKey]),
    })),
    preferences: libraryPreferences,
  };
  const readiness = evaluatePackReadiness({
    autoSync,
    config,
    membership,
    queue,
    scope: scoped.scope,
    session,
  });

  return {
    accounts: toSafeAccountsState(accountsStore, session, { savedSessionUserIds }),
    autoSync,
    bridge: getBridgeState(config),
    configPath: config.configPath,
    game: getGameState(config),
    library: libraryState,
    membership,
    notices: recentPackNotices,
    queue,
    readiness,
    runtime: config.sharedMameRuntime || baseConfig.sharedMameRuntime || null,
    scope: scoped.scope
      ? {
          packKey: scoped.scope.packKey,
          playerKey: scoped.scope.playerKey,
          scopedQueueRoot: scoped.scope.scopedQueueRoot,
          stagingPendingDir: config.stagingEventsPendingDirAbs || null,
        }
      : null,
    session,
    timestamp: new Date().toISOString(),
  };
}

async function runAutoSyncIfEligible(context, options = {}) {
  const eligibilityContext = {
    autoSyncInProgress: autoSyncInProgress || manualSyncInProgress,
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

function resetAutoSyncStateForTests() {
  autoSyncInProgress = false;
  manualSyncInProgress = false;
  autoSyncState = emptyAutoSyncState();
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
    const storedSession = await readSession(config);

    if (!storedSession) {
      return {
        email: null,
        hasSession: false,
        message: "No hay sesión local. Usa npm run login -- <email> en CLI.",
        sessionFile: config.sessionFileAbs,
        status: "missing",
      };
    }

    const expiringSoon = isSessionExpiringSoon(storedSession);

    return {
      email: storedSession.user?.email || null,
      expiresAt: storedSession.session?.expires_at || null,
      hasSession: true,
      message: expiringSoon ? "Sesión local encontrada, pero expira pronto." : "Sesión local encontrada.",
      sessionFile: config.sessionFileAbs,
      status: expiringSoon ? "warning" : "ok",
      userId: storedSession.user?.id || null,
    };
  } catch (error) {
    return {
      email: null,
      error: normalizeMessage(error),
      hasSession: false,
      message: "No se pudo leer la sesión local.",
      sessionFile: config.sessionFileAbs,
      status: "error",
    };
  }
}

function getGameState(config) {
  const supportedGame = listSupportedGames()[0] || null;
  const rom = config.pack?.rom || supportedGame?.launcher?.rom || supportedGame?.primaryRom || "invaders";
  const metadata = config.pack?.metadata || null;
  const manual = resolvePackManual(config.pack);
  const ranking = resolvePackRanking({
    ...(config.pack || {}),
    webBaseUrl: config.pack?.webBaseUrl || config.webBaseUrl,
    weekId: config.pack?.weekId || config.defaultWeekId,
  }, config.webBaseUrl);

  return {
    assets: metadata?.assets || {},
    developer: metadata?.developer || null,
    displayName: metadata?.title || supportedGame?.title || config.pack?.gameId || "Space Invaders",
    genre: metadata?.genre || [],
    gameId: config.pack?.gameId || supportedGame?.gameId || "space-invaders",
    manual: toRendererContentState(manual),
    metadataLoaded: Boolean(config.pack?.metadataLoaded),
    metadataWarnings: config.pack?.metadataWarnings || [],
    publisher: metadata?.publisher || null,
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
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

async function openPackRanking(options = {}) {
  await ensureRememberedPackLoaded();
  const config = options.config || getEffectiveConfig();
  const target = resolvePackRanking(config.pack, config.webBaseUrl);
  const result = await openPackContent(target, {
    ...options,
    externalLine: "Ranking abierto en High Score League.",
    externalSummary: "Ranking abierto en la web.",
  });

  return {
    action: "open-ranking",
    ...result,
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

function getBridgeState(config) {
  const hasExternalMame = Boolean(config.mame?.executablePath && config.mame?.workingDir);
  const packOpened = config.configSource === "pack abierto";
  const mode = packOpened
    ? "opened-pack"
    : config.configExists && !config.packLoaded && hasExternalMame
    ? "dev-bridge"
    : config.packLoaded
      ? "pack"
      : "defaults";

  return {
    activePackName: config.pack?.packId || config.pack?.gameId || null,
    configSource: config.configSource,
    contractStatus: config.pack?.contractStatus || null,
    deprecated: Boolean(config.pack?.deprecated),
    devBridge: mode === "dev-bridge",
    mode,
    packOpened,
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

async function getLauncherState(options = {}) {
  const context = await getLauncherContext();

  if (options.attemptAutoSync) {
    const result = await runAutoSyncIfEligible(context);

    if (result.attempted) {
      return stateFromContext(await getLauncherContext());
    }
  }

  return stateFromContext(context);
}

async function recheckSeasonMembership() {
  return {
    action: "check-membership",
    lines: ["Comprobacion de temporada actualizada."],
    ok: true,
    summary: "Comprobacion de temporada actualizada.",
    state: await getLauncherState({ attemptAutoSync: true }),
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

async function runDiagnose() {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const report = await buildDiagnoseReport(config);
  const source = config.configSource === "pack abierto" ? "pack abierto" : "configuración local";

  return {
    action: "diagnose",
    lines: [
      `Origen: ${source}.`,
      `Diagnóstico: ${report.errors.length} errores, ${report.warnings.length} advertencias.`,
      ...[...new Set(report.recommendations)].map((item) => `Recomendación: ${item}`),
    ],
    ok: report.errors.length === 0,
    report: summarizeDiagnoseReport(report),
    state: await getLauncherState(),
  };
}

async function playCompetition() {
  await ensureRememberedPackLoaded();
  const baseConfig = getEffectiveConfig();

  if (baseConfig.pack?.packVersion === 2 || baseConfig.pack?.contract?.version === 2) {
    const capture = baseConfig.pack?.contract?.capture || {};
    return {
      action: "play-competition",
      lines: [
        "Competicion v2 bloqueada: falta cargar el plugin/adaptador de captura de forma segura.",
        `Modo de captura: ${capture.mode || "no definido"}.`,
        `Plugin: ${capture.pluginName || "no definido"}.`,
        `Adaptador: ${capture.adapter || "no definido"}.`,
        "La practica v2 ya usa MAME compartido.",
        "Siguiente tarea tecnica: LOCAL-MAME-PACK-PLUGIN-LOADING-2.",
      ],
      ok: false,
      summary: "Competicion v2 pendiente de carga segura del adaptador.",
      state: await getLauncherState(),
    };
  }

  const session = await getAuthState(baseConfig);
  const membership = await checkSeasonMembership(baseConfig, session);

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

  const scoped = await getScopedGuiConfig(baseConfig, session);

  if (!scoped.scope) {
    return {
      action: "play-competition",
      lines: [scoped.reason || "No se pudo preparar la cola local de esta cuenta."],
      ok: false,
      summary: "No se pudo preparar la cola local.",
      state: await getLauncherState(),
    };
  }

  const snapshot = await listPendingFileSnapshot(baseConfig.eventsPendingDirAbs);
  const startedAtMs = Date.now();
  const captured = await captureConsoleAsync(() => launchMame(baseConfig, baseConfig.pack?.rom || "invaders", "competition"));
  const exitCode = Number.isInteger(captured.result) ? captured.result : captured.exitCode;
  const adoption = await adoptNewStagingEvents(
    baseConfig.eventsPendingDirAbs,
    scoped.config.eventsPendingDirAbs,
    snapshot,
    startedAtMs
  );
  const legacyLine = snapshot.size > 0
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
      ...captured.lines,
      ...(adoption.adopted.length > 0
        ? [`${adoption.adopted.length} captura(s) nueva(s) movida(s) a la cola de esta cuenta y pack.`]
        : ["No se detectaron capturas nuevas para adoptar."]),
      ...(savedLocallyLine ? [savedLocallyLine] : []),
      ...(legacyLine ? [legacyLine] : []),
    ],
    ok: exitCode === 0,
    result: captured.result || null,
    state: await getLauncherState({ attemptAutoSync: true }),
  };
}

function playPractice() {
  return withFreshState("practice", (config) => launchMame(config, config.pack?.rom || "invaders", "practice"));
}

async function submitAllPending() {
  await ensureRememberedPackLoaded();

  if (autoSyncInProgress || manualSyncInProgress) {
    const summary = autoSyncInProgress
      ? "La sincronizacion automatica ya esta en marcha."
      : "Ya hay una subida en marcha.";

    return {
      action: "submit-all",
      lines: [summary],
      ok: false,
      summary,
      state: await getLauncherState(),
    };
  }

  const baseConfig = getEffectiveConfig();
  const session = await getAuthState(baseConfig);
  const membership = await checkSeasonMembership(baseConfig, session);

  if (!session.hasSession) {
    return {
      action: "submit-all",
      lines: [session.message, "Inicia sesión para subir puntuaciones."],
      ok: false,
      summary: "Inicia sesión para subir puntuaciones.",
      state: await getLauncherState(),
    };
  }

  if (shouldBlockSubmit(membership)) {
    return {
      action: "submit-all",
      lines: [membership.message],
      ok: false,
      summary: membership.message,
      state: await getLauncherState(),
    };
  }

  const scoped = await getScopedGuiConfig(baseConfig, session);

  if (!scoped.scope) {
    return {
      action: "submit-all",
      lines: [scoped.reason || "No se pudo preparar la cola local de esta cuenta."],
      ok: false,
      summary: "No se pudo preparar la cola local.",
      state: await getLauncherState(),
    };
  }

  manualSyncInProgress = true;

  let captured;
  let exitCode;

  try {
    captured = await captureConsoleAsync(() => submitAll(scoped.config));
    exitCode = Number.isInteger(captured.result) ? captured.result : captured.exitCode;
  } finally {
    manualSyncInProgress = false;
  }

  const response = {
    action: "submit-all",
    exitCode,
    lines: captured.lines,
    ok: exitCode === 0,
    result: captured.result || null,
    state: await getLauncherState(),
  };

  if (response.state?.queue?.totals?.failed > 0) {
    response.action = "submit-all-with-failed";
    response.lines = [
      ...response.lines,
      "Las puntuaciones con error estan en Requieren atencion.",
      "Puedes restaurarlas a pendientes cuando corrijas el problema.",
    ];
  }

  return response;
}

async function restoreFailedSubmission(filename) {
  await ensureRememberedPackLoaded();
  const baseConfig = getEffectiveConfig();
  const session = await getAuthState(baseConfig);

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
        "Ahora puedes volver a pulsar Subir pendientes cuando hayas corregido el problema.",
      ],
      ok: true,
      restored: result,
      summary: "Puntuacion restaurada a pendientes.",
      state: await getLauncherState({ attemptAutoSync: true }),
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

  if (result.ok) {
    const storedSession = await readSession(config);
    await saveRememberedSession(config, storedSession);
    await rememberSessionAccount(config, result.session, { touch: true });
  }

  return {
    action: "login",
    lines: [result.message],
    ok: result.ok,
    summary: result.message,
    state: await getLauncherState({ attemptAutoSync: result.ok }),
  };
}

async function logoutSession() {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const session = await getAuthState(config);
  const result = await logoutLocal(config);

  if (session.hasSession && session.userId) {
    await removeKnownAccount(config, session.userId);
  } else {
    await clearActiveAccount(config);
  }

  return {
    action: "logout",
    lines: [result.message, "Cuenta olvidada en este dispositivo.", "Las puntuaciones locales no se han borrado."],
    ok: result.ok,
    summary: "Sesión cerrada.",
    state: await getLauncherState(),
  };
}

async function switchKnownAccountFromGui(userId) {
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

  const remembered = await readRememberedSession(config, account);

  if (!remembered.ok || !remembered.session) {
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

  let storedSession = remembered.session;

  try {
    if (isSessionExpiringSoon(storedSession)) {
      storedSession = await refreshStoredSession({
        ...config,
        sessionFileAbs: remembered.filePath,
      }, storedSession);
    }

    await saveSession(config, storedSession.session, storedSession.user);
    await rememberSessionAccount(config, {
      email: storedSession.user?.email || account.email,
      hasSession: true,
      userId: storedSession.user?.id || account.userId,
    }, { touch: true });

    return {
      action: "switch-account",
      lines: [
        `Cuenta activa: ${storedSession.user?.email || account.email || account.userId}.`,
        "Cambiar cuenta no mezcla puntuaciones locales.",
      ],
      ok: true,
      summary: "Cuenta cambiada.",
      state: await getLauncherState({ attemptAutoSync: true }),
    };
  } catch (error) {
    await deleteRememberedSession(config, account).catch(() => null);

    return {
      action: "switch-account-login-required",
      email: account.email,
      lines: [
        "La sesion guardada ha caducado. Inicia sesion de nuevo.",
        normalizeMessage(error),
      ],
      ok: false,
      requiresLogin: true,
      summary: "La sesion guardada ha caducado.",
      state: await getLauncherState(),
    };
  }
}

async function removeKnownAccountFromGui(userId) {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const session = await getAuthState(config);

  if (session.hasSession && session.userId === userId) {
    await logoutLocal(config);
    const result = await removeKnownAccount(config, userId);

    return {
      action: "remove-known-account",
      lines: ["Cuenta olvidada en este dispositivo.", "La sesión activa se ha cerrado.", "Las puntuaciones locales no se han borrado."],
      ok: result.removed,
      summary: result.removed ? "Cuenta olvidada." : "No se encontró esa cuenta recordada.",
      state: await getLauncherState(),
    };
  }

  const result = await removeKnownAccount(config, userId);
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
  return getAuthState(getEffectiveConfig());
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
      state: options.includeState === false ? null : await getLauncherState(),
    };
  }

  activeOpenedPack = {
    openedAt: new Date().toISOString(),
    pack: result.pack,
    remembered: false,
  };
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
    state: options.includeState === false ? null : await getLauncherState({ attemptAutoSync: true }),
  };
}

async function openPackDirectory(packDir) {
  return activatePackDirectory(packDir);
}

async function cancelChoosePackDirectory() {
  return {
    action: "choose-pack-directory",
    canceled: true,
    lines: ["No se selecciono ningun directorio de packs."],
    ok: true,
    summary: "No se selecciono ningun directorio de packs.",
    state: await getLauncherState(),
  };
}

async function choosePackDirectoryFromGui(directoryPath, options = {}) {
  const config = options.config || loadRuntimeConfig();
  const result = await setPackDirectory(config, directoryPath, options);

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
    state: options.includeState === false ? null : await getLauncherState(),
  };
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
      state: options.includeState === false ? null : await getLauncherState(),
    };
  } catch (error) {
    return {
      action: "choose-shared-mame-runtime",
      lines: [normalizeMessage(error)],
      ok: false,
      summary: "No se pudo configurar MAME compartido.",
      state: options.includeState === false ? null : await getLauncherState(),
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
      state: options.includeState === false ? null : await getLauncherState(),
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
      state: options.includeState === false ? null : await getLauncherState(),
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
      state: options.includeState === false ? null : await getLauncherState(),
    };
  }

  if (!directory.exists) {
    return {
      action: "open-pack-directory",
      lines: ["No encuentro el directorio de packs. Puedes cambiarlo o volver a crearlo."],
      ok: false,
      summary: "No encuentro el directorio de packs.",
      state: options.includeState === false ? null : await getLauncherState(),
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
  return {
    action: "rescan-pack-directory",
    lines: ["Biblioteca reescaneada."],
    ok: true,
    summary: "Biblioteca reescaneada.",
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

async function setLibraryPreferencesFromGui(patch = {}, options = {}) {
  if (!options.config) {
    await ensureRememberedPackLoaded();
  }

  const config = options.config || loadRuntimeConfig();
  const session = options.session || await getAuthState(config);
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
  const session = options.session || await getAuthState(config);
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
      state: options.includeState === false ? null : await getLauncherState(),
    };
  }

  const response = await activatePackDirectory(pack.packDir, {
    action: "use-library-pack",
    includeState: options.includeState,
    rememberConfig: config,
    summary: "Pack activado desde biblioteca.",
  });

  return {
    ...response,
    lines: response.ok
      ? ["Pack activado desde biblioteca.", ...response.lines.slice(1)]
      : response.lines,
  };
}

module.exports = {
  adoptNewStagingEvents,
  activateLibraryPack,
  activatePackDirectory,
  cancelChoosePackDirectory,
  cancelChooseSharedMameRuntime,
  cancelOpenPack,
  chooseSharedMameRuntimeFromGui,
  choosePackDirectoryFromGui,
  classifyFailureReason,
  deriveOpenedPackConfig,
  eventResultToQueueItem,
  getAuthStateForGui,
  getLauncherState,
  loginWithPassword,
  listPendingFileSnapshot,
  logoutSession,
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
  runAutoSyncIfEligible,
  runDiagnose,
  setLibraryPreferencesFromGui,
  submitAllPending,
  summarizeDiagnoseReport,
  switchKnownAccountFromGui,
  syncPlugin,
  toggleLibraryFavoriteFromGui,
};
