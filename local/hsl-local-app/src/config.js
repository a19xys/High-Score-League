const fs = require("fs");
const path = require("path");

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
  if (!fs.existsSync(configPath)) {
    throw new Error(`No existe config.json en ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(raw);

  if (!config.eventsPendingDir || typeof config.eventsPendingDir !== "string") {
    throw new Error("config.json debe incluir eventsPendingDir");
  }

  const eventsSentDir = config.eventsSentDir || "../plugins/hsl-score/events/sent";
  const eventsFailedDir = config.eventsFailedDir || "../plugins/hsl-score/events/failed";
  const sessionFile = config.sessionFile || ".hsl-session.json";

  return {
    ...config,
    eventsSentDir,
    eventsFailedDir,
    sessionFile,
    eventsPendingDirAbs: resolveFromAppDir(config.eventsPendingDir, appDir),
    eventsSentDirAbs: resolveFromAppDir(eventsSentDir, appDir),
    eventsFailedDirAbs: resolveFromAppDir(eventsFailedDir, appDir),
    sessionFileAbs: resolveFromAppDir(sessionFile, appDir),
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
