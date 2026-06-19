const path = require("node:path");
const { loadConfig } = require("../src/config");
const { readSession, isSessionExpiringSoon, logout } = require("../src/auth");
const { buildDiagnoseReport } = require("../src/diagnose");
const { listJsonFiles, readEventFile } = require("../src/event-files");
const { listSupportedGames } = require("../src/games");
const { launchMame } = require("../src/mame-launcher");
const { printSyncPluginResult, syncPluginToPack } = require("../src/dev-sync-plugin");
const { submitAll } = require("../src/submission-service");

function loadRuntimeConfig() {
  return loadConfig();
}

function normalizeMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
        message: "No hay sesion local. Usa npm run login -- <email> en CLI.",
        sessionFile: config.sessionFileAbs,
        status: "missing",
      };
    }

    const expiringSoon = isSessionExpiringSoon(storedSession);

    return {
      email: storedSession.user?.email || null,
      expiresAt: storedSession.session?.expires_at || null,
      hasSession: true,
      message: expiringSoon ? "Sesion local encontrada, pero expira pronto." : "Sesion local encontrada.",
      sessionFile: config.sessionFileAbs,
      status: expiringSoon ? "warning" : "ok",
      userId: storedSession.user?.id || null,
    };
  } catch (error) {
    return {
      email: null,
      error: normalizeMessage(error),
      hasSession: false,
      message: "No se pudo leer la sesion local.",
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
  const mode = config.configExists && !config.packLoaded && hasExternalMame
    ? "dev-bridge"
    : config.packLoaded
      ? "pack"
      : "defaults";

  return {
    configSource: config.configSource,
    devBridge: mode === "dev-bridge",
    mode,
    packLoaded: config.packLoaded,
    packPath: config.packPath,
    pluginName: config.mame?.pluginName || "hsl-score",
    webBaseUrl: config.webBaseUrl || null,
    workingDir: config.mame?.workingDir || null,
  };
}

async function getLauncherState() {
  const config = loadRuntimeConfig();
  const [queue, session] = await Promise.all([
    getQueueState(config),
    getSessionState(config),
  ]);

  return {
    bridge: getBridgeState(config),
    configPath: config.configPath,
    game: getGameState(config),
    queue,
    session,
    timestamp: new Date().toISOString(),
  };
}

async function withFreshState(action, fn) {
  const config = loadRuntimeConfig();
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
  const config = loadRuntimeConfig();
  const report = await buildDiagnoseReport(config);

  return {
    action: "diagnose",
    lines: [
      `Diagnostico: ${report.errors.length} errores, ${report.warnings.length} advertencias.`,
      ...[...new Set(report.recommendations)].map((item) => `Recomendacion: ${item}`),
    ],
    ok: report.errors.length === 0,
    report: summarizeDiagnoseReport(report),
    state: await getLauncherState(),
  };
}

function playCompetition() {
  return withFreshState("play-competition", (config) => launchMame(config, "invaders", "competition"));
}

function playPractice() {
  return withFreshState("practice", (config) => launchMame(config, "invaders", "practice"));
}

function submitAllPending() {
  return withFreshState("submit-all", (config) => submitAll(config));
}

function syncPlugin() {
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

module.exports = {
  eventResultToQueueItem,
  getLauncherState,
  logoutSession,
  playCompetition,
  playPractice,
  runDiagnose,
  submitAllPending,
  summarizeDiagnoseReport,
  syncPlugin,
};
