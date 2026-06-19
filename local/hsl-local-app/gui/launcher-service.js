const fsp = require("node:fs/promises");
const path = require("node:path");
const { loadConfig } = require("../src/config");
const { readSession, isSessionExpiringSoon, logout } = require("../src/auth");
const { buildDiagnoseReport } = require("../src/diagnose");
const { listJsonFiles, readEventFile } = require("../src/event-files");
const { listSupportedGames } = require("../src/games");
const { launchMame } = require("../src/mame-launcher");
const { loadPackFromDir, resolvePackMamePaths } = require("../src/pack");
const { readRecentPackState, writeLastOpenedPack } = require("../src/recent-packs");
const { printSyncPluginResult, syncPluginToPack } = require("../src/dev-sync-plugin");
const { submitAll } = require("../src/submission-service");

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

function eventResultToQueueItem(box, result) {
  return {
    box,
    detectedAt: result.event?.detectedAt || null,
    errors: result.errors || [],
    filename: result.filename,
    fullPath: result.fullPath,
    game: result.event?.game || null,
    ok: result.ok,
    rom: result.event?.rom || null,
    score: Number.isFinite(result.event?.score) ? result.event.score : null,
    source: result.event?.source || null,
    warnings: result.warnings || [],
  };
}

async function readQueueBox(dir, box) {
  try {
    const files = await listJsonFiles(dir);
    const items = [];

    for (const filename of files) {
      const result = await readEventFile(dir, filename);
      items.push(eventResultToQueueItem(box, result));
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

async function getQueueState(config) {
  const [pending, sent, failed] = await Promise.all([
    readQueueBox(config.eventsPendingDirAbs, "pending"),
    readQueueBox(config.eventsSentDirAbs, "sent"),
    readQueueBox(config.eventsFailedDirAbs, "failed"),
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

  return {
    displayName: supportedGame?.title || config.pack?.gameId || "Space Invaders",
    gameId: config.pack?.gameId || supportedGame?.gameId || "space-invaders",
    rom,
    weekId: config.defaultWeekId || null,
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
    packPath: config.packPath,
    packRoot: config.packRoot || null,
    pluginName: config.mame?.pluginName || "hsl-score",
    webBaseUrl: config.webBaseUrl || null,
    workingDir: config.mame?.workingDir || null,
  };
}

async function getLauncherState() {
  await ensureRememberedPackLoaded();
  const config = getEffectiveConfig();
  const [queue, session] = await Promise.all([
    getQueueState(config),
    getSessionState(config),
  ]);

  return {
    bridge: getBridgeState(config),
    configPath: config.configPath,
    game: getGameState(config),
    notices: recentPackNotices,
    queue,
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

function playCompetition() {
  return withFreshState("play-competition", (config) => launchMame(config, config.pack?.rom || "invaders", "competition"));
}

function playPractice() {
  return withFreshState("practice", (config) => launchMame(config, config.pack?.rom || "invaders", "practice"));
}

function submitAllPending() {
  return withFreshState("submit-all", (config) => submitAll(config));
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

function logoutSession() {
  return withFreshState("logout", (config) => logout(config));
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

async function openPackDirectory(packDir) {
  const result = readPackForGui(packDir);

  if (!result.ok) {
    return {
      action: "open-pack",
      code: result.code,
      lines: result.errors,
      ok: false,
      summary: result.code === "missing_pack_json"
        ? "No encuentro pack.json en esta carpeta. Elige la carpeta raíz del pack o crea un pack.json a partir del ejemplo de desarrollo."
        : "El pack no parece válido para High Score League.",
      state: await getLauncherState(),
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
    await writeLastOpenedPack(loadRuntimeConfig(), result.pack.packRoot);
  } catch (error) {
    recentWriteWarning = `No se pudo recordar este pack para el próximo inicio: ${normalizeMessage(error)}`;
  }

  return {
    action: "open-pack",
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
    summary: "Pack abierto correctamente.",
    state: await getLauncherState(),
  };
}

module.exports = {
  cancelOpenPack,
  deriveOpenedPackConfig,
  eventResultToQueueItem,
  getLauncherState,
  logoutSession,
  openPackDirectory,
  playCompetition,
  playPractice,
  readPackForGui,
  resolveRememberedPack,
  runDiagnose,
  submitAllPending,
  summarizeDiagnoseReport,
  syncPlugin,
};
