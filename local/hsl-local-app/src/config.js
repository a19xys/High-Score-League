const fs = require("fs");
const path = require("path");
const { loadDefaultPack } = require("./pack");
const { resolveRuntimePaths } = require("./runtime-paths");

const APP_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const BOXES = new Set(["pending", "sent", "failed"]);

function resolveFromAppDir(value, appDir = APP_DIR) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(appDir, value);
}

function loadConfig(configPath = CONFIG_PATH, appDir = APP_DIR) {
  const configExists = fs.existsSync(configPath);
  const config = configExists ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  const packResult = loadDefaultPack(appDir, config.packPath);
  const pack = packResult.pack;
  const sessionFile = config.sessionFile || (configExists ? ".hsl-session.json" : "userData/session.json");
  const mergedConfig = {
    ...config,
    defaultWeekId: config.defaultWeekId || pack?.weekId,
    eventsBaseDir: config.eventsBaseDir,
    sessionFile,
    userDataDir: config.userDataDir || "auto",
    webBaseUrl: config.webBaseUrl || pack?.webBaseUrl,
  };
  const runtimePaths = resolveRuntimePaths(mergedConfig, pack, { appDir });

  return {
    ...mergedConfig,
    configExists,
    appDir,
    configPath,
    configSource: configExists ? "config.json" : pack ? "pack.json" : "defaults",
    eventsFailedDir: config.eventsFailedDir || null,
    eventsPendingDir: config.eventsPendingDir || null,
    eventsSentDir: config.eventsSentDir || null,
    pack,
    packErrors: packResult.errors,
    packPath: packResult.packPath,
    packLoaded: packResult.loaded,
    sessionFile,
    ...runtimePaths,
  };
}

function getBoxDir(config, box) {
  if (box === "pending") return config.eventsPendingDirAbs;
  if (box === "sent") return config.eventsSentDirAbs;
  if (box === "failed") return config.eventsFailedDirAbs;

  throw new Error(`Caja desconocida: ${box}`);
}

function assertBox(box) {
  if (!BOXES.has(box)) {
    throw new Error(`Caja inválida: ${box}. Usa pending, sent o failed.`);
  }
}

module.exports = {
  APP_DIR,
  BOXES,
  CONFIG_PATH,
  assertBox,
  getBoxDir,
  loadConfig,
  resolveFromAppDir,
};
