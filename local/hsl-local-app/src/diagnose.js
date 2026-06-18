const fsp = require("node:fs/promises");
const path = require("node:path");
const { buildMameArgs, DEFAULT_PLUGIN_NAME } = require("./mame-launcher");

const REQUIRED_CONFIG_FIELDS = [
  "sessionFile",
  "clientVersion",
];

const PACK_OR_DEV_FIELDS = ["webBaseUrl", "defaultWeekId"];
const AUTH_CONFIG_FIELDS = ["supabaseUrl", "supabaseAnonKey"];

function add(report, section, level, message, detail = null) {
  const entry = { level, message, detail };
  report.sections[section].push(entry);

  if (level === "ERROR") {
    report.errors.push(entry);
  }

  if (level === "WARN") {
    report.warnings.push(entry);
  }

  return entry;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function hasUrlProtocol(value) {
  return typeof value === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function looksLikePersonalAbsolutePath(value) {
  if (!isNonEmptyString(value) || !path.isAbsolute(value)) {
    return false;
  }

  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/users/") || normalized.includes("/downloads/") || normalized.includes("/documents/");
}

function getConfigAppDir(config) {
  if (isNonEmptyString(config.appDir)) {
    return path.resolve(config.appDir);
  }

  if (isNonEmptyString(config.configPath)) {
    return path.dirname(path.resolve(config.configPath));
  }

  return path.resolve(__dirname, "..");
}

function isPathOutsideDir(targetPath, baseDir) {
  if (!isNonEmptyString(targetPath)) {
    return false;
  }

  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative));
}

async function getPathInfo(targetPath) {
  if (!isNonEmptyString(targetPath)) {
    return { exists: false, kind: "missing" };
  }

  try {
    const stat = await fsp.stat(targetPath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    };
  } catch {
    return { exists: false, kind: "missing" };
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findGlobalPluginActivation(content, pluginName) {
  const pluginPattern = new RegExp(`^\\s*${escapeRegExp(pluginName)}\\s+1(?:\\s|$)`, "i");
  const lines = String(content).split(/\r?\n/);
  const matches = [];

  for (const [index, line] of lines.entries()) {
    if (/^\s*[#;]/.test(line)) {
      continue;
    }

    if (pluginPattern.test(line)) {
      matches.push({
        line: index + 1,
        text: line.trim(),
      });
    }
  }

  return matches;
}

async function inspectPluginIni(workingDir, pluginName) {
  const candidates = [
    path.join(workingDir, "plugin.ini"),
    path.join(workingDir, "ini", "plugin.ini"),
  ];
  const found = [];
  const active = [];

  for (const candidate of candidates) {
    const info = await getPathInfo(candidate);

    if (!info.exists || !info.isFile) {
      continue;
    }

    found.push(candidate);
    const content = await fsp.readFile(candidate, "utf8");
    const matches = findGlobalPluginActivation(content, pluginName);

    for (const match of matches) {
      active.push({
        path: candidate,
        ...match,
      });
    }
  }

  return {
    active,
    candidates,
    found,
  };
}

async function readSessionSummary(sessionFileAbs) {
  const info = await getPathInfo(sessionFileAbs);

  if (!info.exists) {
    return {
      exists: false,
      validJson: false,
      hasSession: false,
      email: null,
    };
  }

  if (!info.isFile) {
    return {
      exists: true,
      validJson: false,
      hasSession: false,
      email: null,
      error: "La ruta de sesión existe, pero no es un archivo.",
    };
  }

  try {
    const raw = await fsp.readFile(sessionFileAbs, "utf8");
    const data = JSON.parse(raw);

    return {
      exists: true,
      validJson: true,
      hasSession: Boolean(data.session),
      email: data.user?.email || null,
      userId: data.user?.id || null,
    };
  } catch (error) {
    return {
      exists: true,
      validJson: false,
      hasSession: false,
      email: null,
      error: error.message,
    };
  }
}

async function buildDiagnoseReport(config) {
  const appDir = getConfigAppDir(config);
  const checkedEventDirs = [];
  let mameExecutableExists = false;
  let mameWorkingDirExists = false;
  const report = {
    sections: {
      config: [],
      events: [],
      mame: [],
      launcher: [],
      pack: [],
      runtime: [],
      session: [],
    },
    warnings: [],
    errors: [],
    recommendations: [],
  };

  add(report, "config", config.configExists === false ? "INFO" : "OK", config.configExists === false ? "config.json no existe" : "config.json cargado");
  add(report, "config", "OK", `fuente efectiva: ${config.configSource || "config.json"}`);

  if (config.configExists === false) {
    add(report, "config", "INFO", "No hay config.json local; se usan pack/defaults");
  }

  if (config.packLoaded) {
    add(report, "pack", "OK", "pack.json cargado", config.packPath);
  } else {
    add(report, "pack", "INFO", "No se encontró pack.json", config.packPath);
  }

  for (const error of config.packErrors || []) {
    add(report, "pack", "WARN", error);
  }

  const userDataInfo = await getPathInfo(config.userDataDir);
  if (userDataInfo.exists && userDataInfo.isDirectory) {
    add(report, "runtime", "OK", "userDataDir existe", config.userDataDir);
  } else if (userDataInfo.exists) {
    add(report, "runtime", "ERROR", "userDataDir existe, pero no es una carpeta", config.userDataDir);
  } else {
    add(report, "runtime", "INFO", "userDataDir no existe todavía", config.userDataDir);
  }

  add(report, "runtime", "OK", `eventos resueltos desde ${config.eventsSource || "rutas finales"}`);
  add(report, "runtime", "OK", "sessionFile final", config.sessionFileAbs);

  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (isNonEmptyString(config[field])) {
      add(report, "config", "OK", `${field} configurado`, config[field]);
    } else {
      add(report, "config", "WARN", `${field} falta o está vacío`);
    }
  }

  for (const field of PACK_OR_DEV_FIELDS) {
    if (isNonEmptyString(config[field])) {
      add(report, "config", "OK", `${field} configurado`);

      if (field === "webBaseUrl" && !hasUrlProtocol(config[field])) {
        add(report, "config", "WARN", "webBaseUrl no incluye protocolo http:// o https://", config[field]);
      }
    } else {
      add(report, "config", "INFO", `${field} no configurado en config global; puede venir de pack.json`);
    }
  }

  for (const field of AUTH_CONFIG_FIELDS) {
    if (isNonEmptyString(config[field])) {
      add(report, "config", "OK", `${field} configurado`);
    } else {
      add(report, "config", "WARN", `${field} falta o está vacío`);
    }
  }

  if (isNonEmptyString(config.eventsBaseDir)) {
    add(report, "config", "OK", "eventsBaseDir configurado", config.eventsBaseDir);
  }

  const eventDirs = [
    ["eventsPendingDir", "pending", config.eventsPendingDirAbs],
    ["eventsSentDir", "sent", config.eventsSentDirAbs],
    ["eventsFailedDir", "failed", config.eventsFailedDirAbs],
  ];

  for (const [field, label, dir] of eventDirs) {
    const info = await getPathInfo(dir);
    checkedEventDirs.push({
      dir,
      existsDirectory: info.exists && info.isDirectory,
    });

    if (info.exists && info.isDirectory) {
      add(report, "events", "OK", `${field} existe`, dir);
    } else if (info.exists) {
      add(report, "events", "ERROR", `${field} existe, pero no es una carpeta`, dir);
    } else {
      add(report, "events", "ERROR", `No existe la carpeta ${label}`, dir);
    }
  }

  if (!config.mame || typeof config.mame !== "object") {
    add(report, "mame", "INFO", "No hay MAME activo en config global ni pack cargado");
    add(report, "launcher", "INFO", "No se comprueban argumentos de launcher sin pack activo o configuración MAME de desarrollo");
  } else {
    const pluginName = isNonEmptyString(config.mame.pluginName)
      ? config.mame.pluginName.trim()
      : DEFAULT_PLUGIN_NAME;

    if (
      config.configExists &&
      (looksLikePersonalAbsolutePath(config.mame.executablePath) || looksLikePersonalAbsolutePath(config.mame.workingDir))
    ) {
      add(report, "mame", "WARN", "config.json contiene rutas absolutas personales de MAME", [
        "Esto es aceptable en modo desarrollo puente, pero no debe versionarse ni usarse como pack final.",
        config.mame.executablePath,
        config.mame.workingDir,
      ]);
      report.recommendations.push("Para packs descargables, mueve rutas de MAME a pack.json y deja datos persistentes en userData.");
    }

    if (isNonEmptyString(config.mame.executablePath)) {
      const executableInfo = await getPathInfo(config.mame.executablePath);

      if (executableInfo.exists && executableInfo.isFile) {
        mameExecutableExists = true;
        add(report, "mame", "OK", "mame.executablePath existe", config.mame.executablePath);
      } else if (executableInfo.exists) {
        add(report, "mame", "ERROR", "mame.executablePath existe, pero no es un archivo", config.mame.executablePath);
      } else {
        add(report, "mame", "ERROR", "mame.executablePath no existe", config.mame.executablePath);
      }
    } else {
      add(report, "mame", "ERROR", "mame.executablePath falta o está vacío");
    }

    if (isNonEmptyString(config.mame.workingDir)) {
      const workingDirInfo = await getPathInfo(config.mame.workingDir);

      if (workingDirInfo.exists && workingDirInfo.isDirectory) {
        mameWorkingDirExists = true;
        add(report, "mame", "OK", "mame.workingDir existe", config.mame.workingDir);

        const pluginDir = path.join(config.mame.workingDir, "plugins", pluginName);
        const pluginDirInfo = await getPathInfo(pluginDir);

        if (pluginDirInfo.exists && pluginDirInfo.isDirectory) {
          add(report, "mame", "OK", `plugin encontrado: ${pluginName}`, pluginDir);
        } else {
          add(report, "mame", "WARN", `plugin no encontrado en plugins/${pluginName}`, pluginDir);
        }

        const pluginIni = await inspectPluginIni(config.mame.workingDir, pluginName);

        if (pluginIni.active.length > 0) {
          add(report, "mame", "WARN", `${pluginName} parece activado globalmente en plugin.ini`, pluginIni.active);
          report.recommendations.push(
            `Desactiva ${pluginName} globalmente y deja que play lo active explícitamente.`
          );
        } else if (pluginIni.found.length > 0) {
          add(report, "mame", "OK", `No se detectó ${pluginName} activo globalmente`, pluginIni.found);
        } else {
          add(report, "mame", "INFO", "No se encontró plugin.ini en rutas conocidas", pluginIni.candidates);
        }
      } else if (workingDirInfo.exists) {
        add(report, "mame", "ERROR", "mame.workingDir existe, pero no es una carpeta", config.mame.workingDir);
      } else {
        add(report, "mame", "ERROR", "mame.workingDir no existe", config.mame.workingDir);
      }
    } else {
      add(report, "mame", "ERROR", "mame.workingDir falta o está vacío");
    }

    if (isNonEmptyString(config.mame.pluginName)) {
      add(report, "mame", "OK", `pluginName = ${pluginName}`);
    } else {
      add(report, "mame", "WARN", `mame.pluginName falta; se usará ${DEFAULT_PLUGIN_NAME}`);
    }

    try {
      const play = buildMameArgs(config, "invaders", "competition");
      const practice = buildMameArgs(config, "invaders", "practice");
      const playHasPlugin = play.args.includes("-plugin") && play.args.includes(pluginName);
      const practiceHasPlugin = practice.args.includes("-plugin") || practice.args.includes(pluginName);

      if (play.rom === "invaders" && playHasPlugin) {
        add(report, "launcher", "OK", `play invaders incluirá -plugins -plugin ${pluginName}`, play.args);
      } else {
        add(report, "launcher", "ERROR", "play invaders no construye argumentos de competición esperados", play.args);
      }

      if (practice.rom === "invaders" && !practiceHasPlugin) {
        add(report, "launcher", "OK", `practice invaders no incluirá -plugin ${pluginName}`, practice.args);
      } else {
        add(report, "launcher", "ERROR", "practice invaders incluye plugin explícito", practice.args);
      }
    } catch (error) {
      add(report, "launcher", "ERROR", `No se pudieron construir argumentos de launcher: ${error.message}`);
    }
  }

  const devBridgePaths = [
    config.mame?.executablePath,
    config.mame?.workingDir,
    config.eventsPendingDirAbs,
    config.eventsSentDirAbs,
    config.eventsFailedDirAbs,
  ];
  const eventsExist = checkedEventDirs.length === 3 && checkedEventDirs.every((item) => item.existsDirectory);
  const pathsOutsideApp = devBridgePaths.some((item) => isPathOutsideDir(item, appDir));
  const devBridgeDetected = config.configExists === true
    && !config.packLoaded
    && eventsExist
    && mameExecutableExists
    && mameWorkingDirExists
    && pathsOutsideApp;

  if (devBridgeDetected) {
    add(
      report,
      "runtime",
      "INFO",
      "Modo desarrollo puente detectado",
      "La app se ejecuta desde el repo y usa un pack MAME externo configurado en config.json."
    );
  }

  const session = await readSessionSummary(config.sessionFileAbs);

  if (!session.exists) {
    add(report, "session", "INFO", "No hay sesión local. Usa node app.js login <email> antes de submit.", config.sessionFileAbs);
  } else if (!session.validJson) {
    add(report, "session", "WARN", `El archivo de sesión no se pudo leer como JSON: ${session.error}`, config.sessionFileAbs);
  } else if (session.hasSession) {
    add(report, "session", "OK", `sesión local encontrada para ${session.email || session.userId || "usuario desconocido"}`, config.sessionFileAbs);
  } else {
    add(report, "session", "WARN", "El archivo de sesión existe, pero no contiene session", config.sessionFileAbs);
  }

  if (report.errors.length > 0) {
    report.recommendations.push("Corrige los errores antes de usar play, practice, submit o submit-all.");
  }

  if (report.warnings.some((entry) => entry.message.includes("webBaseUrl") || entry.message.includes("supabase"))) {
    report.recommendations.push("Completa la configuración web/Auth antes de usar submit o submit-all.");
  }

  return report;
}

function formatDetail(detail) {
  if (detail === null || detail === undefined) {
    return [];
  }

  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item.path) {
        return `${item.path}:${item.line} ${item.text}`;
      }

      return JSON.stringify(item);
    });
  }

  return [String(detail)];
}

function printEntries(title, entries) {
  console.log(title);

  for (const entry of entries) {
    console.log(`[${entry.level}] ${entry.message}`);

    for (const detail of formatDetail(entry.detail)) {
      console.log(`      ${detail}`);
    }
  }

  console.log("");
}

function printDiagnoseReport(report) {
  console.log("");
  console.log("High Score League Local Diagnose");
  console.log("================================");
  console.log("");

  printEntries("Config", report.sections.config);
  printEntries("Pack", report.sections.pack);
  printEntries("Runtime", report.sections.runtime);
  printEntries("Eventos", report.sections.events);
  printEntries("MAME", report.sections.mame);
  printEntries("Launcher", report.sections.launcher);
  printEntries("Sesión", report.sections.session);

  if (report.warnings.length > 0) {
    printEntries("Advertencias", report.warnings);
  }

  if (report.errors.length > 0) {
    printEntries("Errores", report.errors);
  }

  console.log("Recomendaciones");

  if (report.recommendations.length === 0) {
    console.log("[OK] No hay acciones manuales obligatorias detectadas.");
  } else {
    for (const recommendation of [...new Set(report.recommendations)]) {
      console.log(`[INFO] ${recommendation}`);
    }
  }

  console.log("");
}

async function diagnose(config) {
  const report = await buildDiagnoseReport(config);
  printDiagnoseReport(report);

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }

  return report;
}

module.exports = {
  buildDiagnoseReport,
  diagnose,
  findGlobalPluginActivation,
  inspectPluginIni,
  printDiagnoseReport,
  readSessionSummary,
};
