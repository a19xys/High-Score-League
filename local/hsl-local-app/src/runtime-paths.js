const os = require("node:os");
const path = require("node:path");
const { resolvePackMamePaths } = require("./pack");

function getHomeDir(options = {}) {
  return options.homeDir || options.env?.HOME || options.env?.USERPROFILE || os.homedir();
}

function getDefaultUserDataDir(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;

  if (platform === "win32") {
    const baseDir = env.APPDATA || env.LOCALAPPDATA || path.join(getHomeDir(options), "AppData", "Roaming");
    return path.join(baseDir, "High Score League");
  }

  if (platform === "darwin") {
    return path.join(getHomeDir(options), "Library", "Application Support", "High Score League");
  }

  const baseDir = env.XDG_DATA_HOME || path.join(getHomeDir(options), ".local", "share");
  return path.join(baseDir, "high-score-league");
}

function isUserDataPath(value) {
  return typeof value === "string" && /^userData(?:[\\/]|$)/.test(value);
}

function resolvePathValue(value, context) {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (isUserDataPath(value)) {
    const rest = value.replace(/^userData[\\/]?/, "");
    return path.resolve(context.userDataDir, rest);
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(context.appDir, value);
}

function resolveUserDataDir(config = {}, options = {}) {
  const configured = config.userDataDir;

  if (!configured || configured === "auto") {
    return getDefaultUserDataDir(options);
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }

  return path.resolve(options.appDir || process.cwd(), configured);
}

function resolveEventDirs(config = {}, context) {
  const explicitPending = resolvePathValue(config.eventsPendingDir, context);
  const explicitSent = resolvePathValue(config.eventsSentDir, context);
  const explicitFailed = resolvePathValue(config.eventsFailedDir, context);

  if (explicitPending || explicitSent || explicitFailed) {
    return {
      eventsBaseDirAbs: null,
      eventsPendingDirAbs: explicitPending || path.resolve(context.userDataDir, "events", "pending"),
      eventsSentDirAbs: explicitSent || path.resolve(context.userDataDir, "events", "sent"),
      eventsFailedDirAbs: explicitFailed || path.resolve(context.userDataDir, "events", "failed"),
      eventsSource: "explicit",
    };
  }

  const eventsBaseDirAbs = resolvePathValue(config.eventsBaseDir || "userData/events", context);

  return {
    eventsBaseDirAbs,
    eventsPendingDirAbs: path.join(eventsBaseDirAbs, "pending"),
    eventsSentDirAbs: path.join(eventsBaseDirAbs, "sent"),
    eventsFailedDirAbs: path.join(eventsBaseDirAbs, "failed"),
    eventsSource: config.eventsBaseDir ? "eventsBaseDir" : "userData",
  };
}

function resolveRuntimePaths(config = {}, pack = null, options = {}) {
  const appDir = options.appDir || process.cwd();
  const packRoot = options.packRoot || pack?.packRoot || path.resolve(appDir, "..");
  const userDataDir = resolveUserDataDir(config, { ...options, appDir });
  const context = { appDir, packRoot, userDataDir };
  const eventDirs = resolveEventDirs(config, context);
  const sessionFileAbs = resolvePathValue(config.sessionFile || "userData/session.json", context);
  let mame = config.mame;

  if (!mame && pack?.mame) {
    mame = resolvePackMamePaths(pack, context.packRoot);
  }

  return {
    ...eventDirs,
    mame,
    packRoot,
    sessionFileAbs,
    userDataDir,
  };
}

module.exports = {
  getDefaultUserDataDir,
  resolveRuntimePaths,
  resolveUserDataDir,
  resolvePathValue,
};
