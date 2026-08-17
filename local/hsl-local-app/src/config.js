const fs = require("fs");
const path = require("path");
const { loadDefaultPack } = require("./pack");
const { OFFICIAL_HSL_ORIGIN, resolveHslOrigin } = require("./hsl-origin");
const { resolveRuntimePaths } = require("./runtime-paths");
const { readSharedMameRuntime } = require("./shared-mame-runtime");
const { validateProductPublicConfig } = require("./product-config");
const { getProductRuntime } = require("./product-runtime");
const packageMetadata = require("../package.json");

const APP_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const BOXES = new Set(["pending", "sent", "failed"]);

function resolveFromAppDir(value, appDir = APP_DIR) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(appDir, value);
}

function loadConfig(configPath = CONFIG_PATH, appDir = APP_DIR, options = {}) {
  const configExists = fs.existsSync(configPath);
  const config = configExists ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  const packResult = loadDefaultPack(appDir, config.packPath);
  const pack = packResult.pack;
  const sessionFile = config.sessionFile || (configExists ? ".hsl-session.json" : "userData/session.json");
  const environment = options.environment || process.env;
  const productRuntime = options.productRuntime || getProductRuntime();
  const productConfig = productRuntime.isPackaged
    ? validateProductPublicConfig(productRuntime.productConfig)
    : null;
  const remoteConfiguration = resolveHslOrigin({
    configuredOrigin: productConfig?.hslOrigin || config.hslOrigin,
    environmentOrigin: productRuntime.isPackaged ? undefined : environment.HSL_ORIGIN,
    legacyWebBaseUrl: config.webBaseUrl,
    officialOrigin: options.officialOrigin === undefined ? OFFICIAL_HSL_ORIGIN : options.officialOrigin,
  });
  const hslOrigin = remoteConfiguration.hslOrigin;
  const mergedConfig = {
    ...config,
    defaultWeekId: config.defaultWeekId || pack?.weekId,
    eventsBaseDir: config.eventsBaseDir,
    globalWebBaseUrl: hslOrigin,
    hslOrigin,
    remoteConfiguration,
    sessionFile,
    clientVersion: options.clientVersion || productRuntime.version || packageMetadata.version,
    productConfigSource: productConfig ? "product-metadata" : configExists ? "config.json" : "none",
    supabaseAnonKey: productConfig?.supabasePublishableKey || config.supabasePublishableKey || config.supabaseAnonKey || null,
    supabasePublishableKey: productConfig?.supabasePublishableKey || config.supabasePublishableKey || config.supabaseAnonKey || null,
    supabaseUrl: productConfig?.supabaseUrl || config.supabaseUrl || null,
    userDataDir: environment.HSL_USER_DATA_DIR || productRuntime.userDataDir || config.userDataDir || "auto",
    webBaseUrl: hslOrigin,
  };
  const runtimePaths = resolveRuntimePaths(mergedConfig, pack, { appDir });
  const sharedMameRuntime = readSharedMameRuntime({
    ...mergedConfig,
    ...runtimePaths,
  }, { productRuntime });

  return {
    ...mergedConfig,
    configExists,
    appDir,
    configPath,
    configSource: configExists ? "config.json" : pack ? "pack.json" : "defaults",
    eventsFailedDir: config.eventsFailedDir || null,
    eventsPendingDir: config.eventsPendingDir || null,
    eventsRejectedDir: config.eventsRejectedDir || null,
    eventsSentDir: config.eventsSentDir || null,
    pack,
    packErrors: packResult.errors,
    packPath: packResult.packPath,
    packLoaded: packResult.loaded,
    sessionFile,
    sharedMameRuntime,
    ...runtimePaths,
  };
}

function getBoxDir(config, box) {
  if (box === "pending") return config.eventsPendingDirAbs;
  if (box === "sent") return config.eventsSentDirAbs;
  if (box === "failed") return config.eventsFailedDirAbs;
  if (box === "rejected") return config.eventsRejectedDirAbs;

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
