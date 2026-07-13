const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SENSITIVE_KEY_PATTERN = /^(access_token|refresh_token|authorization|password|passwd|cookie|set-cookie)$/i;
const SENSITIVE_TEXT_PATTERN = /\b(access_token|refresh_token|Authorization|password|cookie)\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scrubText(value) {
  return String(value)
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_TEXT_PATTERN, "[redacted]");
}

function sanitizeDiagnosticReport(input) {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === "string") {
    return scrubText(input);
  }

  if (typeof input !== "object") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeDiagnosticReport);
  }

  const output = {};

  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    output[scrubText(key)] = sanitizeDiagnosticReport(value);
  }

  return output;
}

function safeTimestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value || Date.now());
  const iso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();

  return {
    filename: iso.replace(/[:.]/g, "").replace(/Z$/, "Z"),
    iso,
  };
}

function maskId(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}...`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function countReportLevels(report) {
  return {
    errors: Array.isArray(report?.errors) ? report.errors.length : 0,
    recommendations: Array.isArray(report?.recommendations) ? new Set(report.recommendations).size : 0,
    warnings: Array.isArray(report?.warnings) ? report.warnings.length : 0,
  };
}

function summarizePack(config = {}, state = null) {
  if (state && Object.prototype.hasOwnProperty.call(state, "activePack") && !state.activePack) {
    return {
      activePackName: null,
      gameId: null,
      instanceKey: null,
      packDir: null,
      packId: null,
      packLoaded: false,
      packPath: null,
      packRoot: null,
      rom: null,
      seasonId: null,
      weekId: null,
    };
  }

  const game = state?.game || {};
  const pack = config.pack || {};

  return {
    activePackName: state?.bridge?.activePackName || pack.packId || pack.gameId || null,
    gameId: pack.gameId || game.gameId || null,
    instanceKey: state?.activePack?.instanceKey || game.instanceKey || null,
    packDir: state?.bridge?.packRoot || config.packRoot || pack.packRoot || null,
    packId: pack.packId || null,
    packLoaded: Boolean(config.packLoaded || pack.packId || pack.gameId),
    packPath: config.packPath || pack.packPath || null,
    packRoot: config.packRoot || pack.packRoot || null,
    rom: pack.rom || game.rom || null,
    seasonId: pack.seasonId || game.seasonId || null,
    weekId: config.defaultWeekId || pack.weekId || game.weekId || null,
  };
}

function summarizeMame(config = {}) {
  return {
    executablePath: config.mame?.executablePath || config.sharedMameRuntime?.mameExecutablePath || null,
    pluginName: config.mame?.pluginName || config.pack?.contract?.capture?.pluginName || null,
    sharedRuntime: config.sharedMameRuntime
      ? {
          available: Boolean(config.sharedMameRuntime.available),
          configured: Boolean(config.sharedMameRuntime.configured),
          mameExecutablePath: config.sharedMameRuntime.mameExecutablePath || null,
          runtimeFile: config.sharedMameRuntime.runtimeFile || null,
          warnings: config.sharedMameRuntime.warnings || [],
        }
      : null,
    workingDir: config.mame?.workingDir || null,
  };
}

function summarizeLibrary(state = null) {
  if (!state?.library) {
    return null;
  }

  return {
    directory: state.library.directory || null,
    packCount: state.library.packs?.length || 0,
    packDirectoryPath: state.library.packDirectoryPath || null,
    rootPath: state.library.directory?.path || null,
    selection: state.selection
      ? {
          activeInstanceKey: state.selection.activeInstanceKey || null,
          rememberedInstanceKey: state.selection.rememberedInstanceKey || null,
          source: state.selection.source || "none",
        }
      : null,
    source: state.library.source || null,
    status: state.library.status || null,
    totals: state.library.totals || null,
    warnings: state.library.warnings || [],
  };
}

function summarizeSession(state = null) {
  const session = state?.session || {};

  return {
    expiresAt: session.expiresAt || null,
    hasSession: Boolean(session.hasSession),
    status: session.status || null,
    userId: maskId(session.userId),
  };
}

function buildDiagnosticPayload(config, report, context = {}, options = {}) {
  const timestamp = safeTimestamp(options.now);
  const state = context.state || null;

  return sanitizeDiagnosticReport({
    schemaVersion: 1,
    generatedAt: timestamp.iso,
    launcherVersion: config.clientVersion || null,
    platform: {
      arch: process.arch,
      platform: process.platform,
      release: os.release(),
      type: os.type(),
    },
    paths: {
      configPath: config.configPath || null,
      diagnosticsDir: config.userDataDir ? path.join(config.userDataDir, "diagnostics") : null,
      packDirectoryPath: state?.library?.packDirectoryPath || null,
      userDataDir: config.userDataDir || null,
    },
    config: {
      configSource: config.configSource || null,
      eventQueueRole: config.eventQueueRole || null,
      eventsSource: config.eventsSource || null,
      requiresSharedMameRuntime: Boolean(config.requiresSharedMameRuntime),
    },
    bridge: state?.bridge || null,
    diagnose: {
      counts: countReportLevels(report),
      errors: report?.errors || [],
      recommendations: Array.isArray(report?.recommendations) ? [...new Set(report.recommendations)] : [],
      report,
      summary: context.summary || null,
      warnings: report?.warnings || [],
    },
    library: summarizeLibrary(state),
    mame: summarizeMame(config),
    pack: summarizePack(config, state),
    queue: state?.queue
      ? {
          failed: state.queue.failed ? { count: state.queue.failed.count, exists: state.queue.failed.exists } : null,
          pending: state.queue.pending ? { count: state.queue.pending.count, exists: state.queue.pending.exists } : null,
          sent: state.queue.sent ? { count: state.queue.sent.count, exists: state.queue.sent.exists } : null,
          totals: state.queue.totals || null,
        }
      : null,
    runtime: state?.runtime || config.sharedMameRuntime || null,
    session: summarizeSession(state),
  });
}

function getDiagnosticsDir(config) {
  if (!config?.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para diagnosticos.");
  }

  return path.join(config.userDataDir, "diagnostics");
}

async function writeDiagnosticReport(config, report, context = {}, options = {}) {
  const diagnosticsDir = getDiagnosticsDir(config);
  const timestamp = safeTimestamp(options.now);
  const filename = `diagnose-${timestamp.filename}.json`;
  const filePath = path.join(diagnosticsDir, filename);
  const mkdir = options.mkdirImpl || fsp.mkdir;
  const writeFile = options.writeFileImpl || fsp.writeFile;
  const payload = buildDiagnosticPayload(config, report, context, {
    ...options,
    now: timestamp.iso,
  });

  await mkdir(diagnosticsDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    diagnosticsDir,
    filePath,
    filename,
    format: "json",
    payload,
  };
}

async function listDiagnosticReports(config, options = {}) {
  const diagnosticsDir = getDiagnosticsDir(config);
  const readdir = options.readdirImpl || fsp.readdir;
  const files = await readdir(diagnosticsDir).catch(() => []);

  return files
    .filter((filename) => /^diagnose-\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z\.json$/.test(filename))
    .sort()
    .map((filename) => path.join(diagnosticsDir, filename));
}

module.exports = {
  buildDiagnosticPayload,
  listDiagnosticReports,
  sanitizeDiagnosticReport,
  writeDiagnosticReport,
};
