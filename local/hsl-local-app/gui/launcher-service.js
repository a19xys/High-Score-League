const fsp = require("node:fs/promises");
const path = require("node:path");
const { loadConfig } = require("../src/config");
const {
  getAuthState,
  isSessionExpiringSoon,
  logoutLocal,
  readSession,
  signInWithPassword,
} = require("../src/auth");
const { buildDiagnoseReport } = require("../src/diagnose");
const { listJsonFiles, readEventFile } = require("../src/event-files");
const { listSupportedGames } = require("../src/games");
const { addLibraryLocation, removeLibraryLocation } = require("../src/library-locations");
const { launchMame } = require("../src/mame-launcher");
const { scanPackLibrary } = require("../src/pack-library");
const { loadPackFromDir, resolvePackMamePaths } = require("../src/pack");
const { readRecentPackState, writeLastOpenedPack } = require("../src/recent-packs");
const { printSyncPluginResult, syncPluginToPack } = require("../src/dev-sync-plugin");
const { submitAll } = require("../src/submission-service");
const { moveFileSafe, readFailureNote, restoreBoxToPending } = require("../src/file-queue");
const { applyScopedQueue, ensureScopedQueue } = require("../src/scoped-queue");

let activeOpenedPack = null;
let recentPackLoadAttempted = false;
let recentPackNotices = [];

function loadRuntimeConfig() {
  return loadConfig();
}

function getPackPluginName(pack) {
  return pack?.mame?.pluginName || pack?.plugin?.name || "hsl-score";
}

function deriveOpenedPackConfig(baseConfig, pack) {
  const pluginName = getPackPluginName(pack);
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
  const eventsBaseDirAbs = path.join(mame.workingDir, "plugins", pluginName, "events");

  return {
    ...baseConfig,
    configSource: "pack abierto",
    defaultWeekId: pack.weekId,
    eventsBaseDirAbs,
    eventsFailedDir: null,
    eventsFailedDirAbs: path.join(eventsBaseDirAbs, "failed"),
    eventsPendingDir: null,
    eventsPendingDirAbs: path.join(eventsBaseDirAbs, "pending"),
    eventsSentDir: null,
    eventsSentDirAbs: path.join(eventsBaseDirAbs, "sent"),
    eventsSource: "opened-pack",
    mame,
    mameSource: "opened-pack",
    pack,
    packErrors: [],
    packLoaded: true,
    packPath: pack.packPath,
    packRoot: pack.packRoot,
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

  return {
    assets: metadata?.assets || {},
    developer: metadata?.developer || null,
    displayName: metadata?.title || supportedGame?.title || config.pack?.gameId || "Space Invaders",
    genre: metadata?.genre || [],
    gameId: config.pack?.gameId || supportedGame?.gameId || "space-invaders",
    manualUrl: metadata?.manualUrl || null,
    metadataLoaded: Boolean(config.pack?.metadataLoaded),
    metadataWarnings: config.pack?.metadataWarnings || [],
    publisher: metadata?.publisher || null,
    rankingUrl: metadata?.rankingUrl || null,
    rom,
    shortDescription: metadata?.shortDescription || null,
    subtitle: metadata?.subtitle || null,
    weekId: config.defaultWeekId || null,
    year: metadata?.year || null,
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
    webBaseUrl: config.webBaseUrl || null,
    workingDir: config.mame?.workingDir || null,
  };
}

async function getLauncherState() {
  await ensureRememberedPackLoaded();
  const baseConfig = getEffectiveConfig();
  const session = await getAuthState(baseConfig);
  const scoped = await getScopedGuiConfig(baseConfig, session);
  const queue = scoped.scope
    ? await getQueueState(scoped.config)
    : getEmptyQueueState(baseConfig, scoped.reason);

  return {
    bridge: getBridgeState(scoped.config),
    configPath: scoped.config.configPath,
    game: getGameState(scoped.config),
    library: await scanPackLibrary(baseConfig),
    notices: recentPackNotices,
    queue,
    scope: scoped.scope
      ? {
          packKey: scoped.scope.packKey,
          playerKey: scoped.scope.playerKey,
          scopedQueueRoot: scoped.scope.scopedQueueRoot,
          stagingPendingDir: scoped.config.stagingEventsPendingDirAbs || null,
        }
      : null,
    session,
    timestamp: new Date().toISOString(),
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
  const session = await getAuthState(baseConfig);

  if (!session.hasSession) {
    return {
      action: "play-competition",
      lines: ["Inicia sesion para jugar en competicion y guardar puntuaciones en tu cola local."],
      ok: false,
      summary: "Inicia sesion para jugar en competicion.",
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

  return {
    action: "play-competition",
    adoption,
    exitCode,
    lines: [
      ...captured.lines,
      ...(adoption.adopted.length > 0
        ? [`${adoption.adopted.length} captura(s) nueva(s) movida(s) a la cola de esta cuenta y pack.`]
        : ["No se detectaron capturas nuevas para adoptar."]),
      ...(legacyLine ? [legacyLine] : []),
    ],
    ok: exitCode === 0,
    result: captured.result || null,
    state: await getLauncherState(),
  };
}

function playPractice() {
  return withFreshState("practice", (config) => launchMame(config, config.pack?.rom || "invaders", "practice"));
}

async function submitAllPending() {
  await ensureRememberedPackLoaded();
  const baseConfig = getEffectiveConfig();
  const session = await getAuthState(baseConfig);

  if (!session.hasSession) {
    return {
      action: "submit-all",
      lines: [session.message, "Inicia sesión para subir puntuaciones."],
      ok: false,
      summary: "Inicia sesión para subir puntuaciones.",
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

  const captured = await captureConsoleAsync(() => submitAll(scoped.config));
  const exitCode = Number.isInteger(captured.result) ? captured.result : captured.exitCode;
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
  const result = await logoutLocal(config);

  return {
    action: "logout",
    lines: [result.message, "Cerrar sesión no borra puntuaciones locales."],
    ok: result.ok,
    summary: result.message,
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
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

async function openPackDirectory(packDir) {
  return activatePackDirectory(packDir);
}

async function cancelAddLibraryLocation() {
  return {
    action: "add-library-location",
    canceled: true,
    lines: ["No se selecciono ninguna ubicacion."],
    ok: true,
    summary: "No se selecciono ninguna ubicacion.",
    state: await getLauncherState(),
  };
}

async function addLibraryLocationFromGui(locationPath, options = {}) {
  const config = options.config || loadRuntimeConfig();
  const result = await addLibraryLocation(config, locationPath);
  const summary = result.duplicate ? "Esta ubicacion ya estaba anadida." : "Ubicacion anadida.";

  return {
    action: "add-library-location",
    lines: [summary, "No se han copiado ni movido packs."],
    ok: true,
    result,
    summary,
    state: options.includeState === false ? null : await getLauncherState(),
  };
}

async function removeLibraryLocationFromGui(locationId, options = {}) {
  const config = options.config || loadRuntimeConfig();
  const result = await removeLibraryLocation(config, locationId);
  const summary = result.removed
    ? "Ubicacion quitada de la biblioteca. No se ha borrado ninguna carpeta."
    : "No se encontro esa ubicacion en la biblioteca.";

  return {
    action: "remove-library-location",
    lines: [summary],
    ok: result.removed,
    result,
    summary,
    state: options.includeState === false ? null : await getLauncherState(),
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
  addLibraryLocationFromGui,
  cancelAddLibraryLocation,
  cancelOpenPack,
  classifyFailureReason,
  deriveOpenedPackConfig,
  eventResultToQueueItem,
  getAuthStateForGui,
  getLauncherState,
  loginWithPassword,
  listPendingFileSnapshot,
  logoutSession,
  openPackDirectory,
  playCompetition,
  playPractice,
  readPackForGui,
  removeLibraryLocationFromGui,
  restoreFailedSubmission,
  resolveRememberedPack,
  runDiagnose,
  submitAllPending,
  summarizeDiagnoseReport,
  syncPlugin,
};
