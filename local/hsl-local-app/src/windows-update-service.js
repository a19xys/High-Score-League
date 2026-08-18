const fs = require("node:fs");
const path = require("node:path");

const UPDATE_STATES = new Set([
  "disabled",
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
]);

function asIsoTimestamp(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeVersion(value) {
  const version = typeof value === "string" ? value.trim() : "";
  return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(version) ? version : null;
}

function safeErrorCode(error, fallback) {
  const candidate = typeof error?.code === "string" ? error.code.trim() : "";
  return /^[A-Z0-9_]{3,80}$/.test(candidate) ? candidate : fallback;
}

function safeProgress(value) {
  const percent = Number(value?.percent);
  if (!Number.isFinite(percent)) return null;
  return { percent: Math.round(Math.max(0, Math.min(100, percent)) * 10) / 10 };
}

function resolveWindowsUpdateEnablement(options = {}) {
  const packaged = options.packaged === true;
  const platform = String(options.platform || "unknown");
  const configPath = path.join(String(options.resourcesPath || ""), "app-update.yml");
  const existsSync = options.existsSync || fs.existsSync;

  if (!packaged) return { enabled: false, enableReason: "development", configPath };
  if (platform !== "win32") return { enabled: false, enableReason: "non-windows", configPath };
  if (options.packagedSmoke === true) return { enabled: false, enableReason: "packaged-smoke", configPath };
  if (!existsSync(configPath)) return { enabled: false, enableReason: "missing-app-update-config", configPath };
  return { enabled: true, enableReason: "nsis-github-config", configPath };
}

function configureAutoUpdater(autoUpdater, logger = null) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.disableWebInstaller = true;
  if (logger) autoUpdater.logger = logger;
  return autoUpdater;
}

function createWindowsUpdateService(options = {}) {
  const now = options.now || (() => new Date());
  const enablement = resolveWindowsUpdateEnablement(options);
  const listeners = new Map();
  const diagnostic = typeof options.onDiagnostic === "function" ? options.onDiagnostic : () => {};
  const notify = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
  const safeLogger = Object.freeze({ debug() {}, error() {}, info() {}, warn() {} });
  let updater = options.updater || null;
  let initialized = false;
  let shutdown = false;
  let accepted = false;
  let installRequested = false;
  let checkPromise = null;
  let checkCancellationToken = null;
  let activeDownloadPromise = null;
  let resolveActiveDownload = null;
  let state = {
    enabled: enablement.enabled,
    enableReason: enablement.enableReason,
    packaged: options.packaged === true,
    platform: String(options.platform || "unknown"),
    currentVersion: safeVersion(options.currentVersion),
    state: enablement.enabled ? "idle" : "disabled",
    checkAttempted: false,
    declinedThisRun: false,
    updateVersion: null,
    lastCheckAt: null,
    lastErrorCode: null,
    downloadStartedAt: null,
    downloadedAt: null,
    installRequestedAt: null,
    progress: null,
  };

  function getState() {
    return {
      ...state,
      progress: state.progress ? { ...state.progress } : null,
    };
  }

  function publish(patch = {}) {
    const nextState = UPDATE_STATES.has(patch.state) ? patch.state : state.state;
    state = { ...state, ...patch, state: nextState };
    const publicState = getState();
    notify(publicState);
    return publicState;
  }

  function recordError(error, phase) {
    const fallbacks = {
      check: "UPDATE_CHECK_FAILED",
      download: "UPDATE_DOWNLOAD_FAILED",
      install: "UPDATE_INSTALL_FAILED",
    };
    const lastErrorCode = safeErrorCode(error, fallbacks[phase] || "UPDATE_FAILED");
    diagnostic({ event: "windows-update-error", phase, errorCode: lastErrorCode });
    publish({ lastErrorCode, progress: null, state: "error" });
    return lastErrorCode;
  }

  function settleDownload(result) {
    const resolve = resolveActiveDownload;
    resolveActiveDownload = null;
    activeDownloadPromise = null;
    resolve?.(result);
  }

  function listen(eventName, handler) {
    updater.on(eventName, handler);
    listeners.set(eventName, handler);
  }

  function handleUpdateAvailable(info) {
    if (shutdown || state.declinedThisRun || !["checking", "idle"].includes(state.state)) return;
    publish({
      lastErrorCode: null,
      progress: null,
      state: "available",
      updateVersion: safeVersion(info?.version),
    });
  }

  function handleUpdateNotAvailable() {
    if (shutdown || state.state !== "checking") return;
    publish({ lastErrorCode: null, progress: null, state: "idle", updateVersion: null });
  }

  function handleDownloadProgress(progress) {
    if (shutdown || state.state !== "downloading") return;
    publish({ progress: safeProgress(progress) });
  }

  function handleUpdaterError(error) {
    if (shutdown) return;
    const phase = state.state === "installing"
      ? "install"
      : state.state === "downloading" || state.state === "downloaded"
        ? "download"
        : "check";
    const errorCode = recordError(error, phase);
    if (phase === "install") options.onInstallFailed?.();
    if (phase !== "check") settleDownload({ errorCode, ok: false, state: getState() });
  }

  function handleUpdateDownloaded(info) {
    if (shutdown || !accepted || installRequested || state.state !== "downloading") return;
    publish({
      downloadedAt: asIsoTimestamp(now),
      progress: { percent: 100 },
      state: "downloaded",
      updateVersion: safeVersion(info?.version) || state.updateVersion,
    });

    if (options.canInstall?.() === false) {
      const errorCode = "UPDATE_INSTALL_SKIPPED_EXIT_IN_PROGRESS";
      diagnostic({ event: "windows-update-install-skipped", errorCode });
      settleDownload({ errorCode, ok: false, state: getState() });
      return;
    }

    installRequested = true;
    options.onBeforeInstall?.();
    publish({ installRequestedAt: asIsoTimestamp(now), state: "installing" });
    try {
      updater.quitAndInstall(true, true);
    } catch (error) {
      options.onInstallFailed?.();
      const errorCode = recordError(error, "install");
      settleDownload({ errorCode, ok: false, state: getState() });
      return;
    }

    if (state.state === "installing") {
      settleDownload({ ok: true, state: getState(), status: "installing" });
    }
  }

  function initialize() {
    if (initialized || !enablement.enabled || shutdown) return getState();
    initialized = true;
    updater = updater || options.loadUpdater?.();
    if (!updater) {
      publish({ enabled: false, enableReason: "updater-unavailable", state: "disabled" });
      return getState();
    }
    configureAutoUpdater(updater, safeLogger);
    listen("update-available", handleUpdateAvailable);
    listen("update-not-available", handleUpdateNotAvailable);
    listen("download-progress", handleDownloadProgress);
    listen("update-downloaded", handleUpdateDownloaded);
    listen("error", handleUpdaterError);
    return getState();
  }

  function checkOnce() {
    if (!state.enabled || shutdown || state.checkAttempted) return checkPromise || Promise.resolve(getState());
    initialize();
    if (!state.enabled || !updater) return Promise.resolve(getState());

    publish({
      checkAttempted: true,
      lastCheckAt: asIsoTimestamp(now),
      lastErrorCode: null,
      state: "checking",
    });
    checkPromise = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then((result) => {
        checkCancellationToken = result?.cancellationToken || null;
        if (!shutdown && state.state === "checking" && result?.isUpdateAvailable === false) {
          handleUpdateNotAvailable();
        }
        return getState();
      })
      .catch((error) => {
        if (!shutdown && state.state === "checking") recordError(error, "check");
        return getState();
      });
    return checkPromise;
  }

  function decline() {
    if (shutdown || state.state !== "available") return getState();
    accepted = false;
    return publish({ declinedThisRun: true, progress: null, state: "idle" });
  }

  function accept() {
    if (activeDownloadPromise) return activeDownloadPromise;
    if (shutdown || state.state !== "available" || state.declinedThisRun || !updater) {
      return Promise.resolve({ errorCode: "UPDATE_NOT_AVAILABLE", ok: false, state: getState() });
    }

    accepted = true;
    publish({
      downloadStartedAt: asIsoTimestamp(now),
      lastErrorCode: null,
      progress: null,
      state: "downloading",
    });
    activeDownloadPromise = new Promise((resolve) => {
      resolveActiveDownload = resolve;
    });
    Promise.resolve()
      .then(() => updater.downloadUpdate(checkCancellationToken || undefined))
      .then(() => {
        if (!shutdown && state.state === "downloading") {
          const errorCode = recordError(null, "download");
          settleDownload({ errorCode, ok: false, state: getState() });
        }
      })
      .catch((error) => {
        if (shutdown) return;
        if (state.state === "downloading") {
          const errorCode = recordError(error, "download");
          settleDownload({ errorCode, ok: false, state: getState() });
        }
      });
    return activeDownloadPromise;
  }

  function shutdownService(reason = "shutdown") {
    if (shutdown) return getState();
    shutdown = true;
    accepted = false;
    checkCancellationToken?.cancel?.();
    for (const [eventName, handler] of listeners) {
      updater?.removeListener?.(eventName, handler);
    }
    listeners.clear();
    if (activeDownloadPromise) {
      settleDownload({ errorCode: "UPDATE_SHUTDOWN", ok: false, state: getState() });
    }
    diagnostic({ event: "windows-update-shutdown", reason: String(reason).slice(0, 40) });
    return getState();
  }

  return {
    accept,
    checkOnce,
    decline,
    getState,
    initialize,
    shutdown: shutdownService,
  };
}

module.exports = {
  configureAutoUpdater,
  createWindowsUpdateService,
  resolveWindowsUpdateEnablement,
  safeErrorCode,
  safeProgress,
  safeVersion,
};
