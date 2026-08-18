const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  configureAutoUpdater,
  createWindowsUpdateService,
  resolveWindowsUpdateEnablement,
} = require("../src/windows-update-service");

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = [];
    this.checkResult = { isUpdateAvailable: false };
    this.downloadImpl = async () => [];
  }

  async checkForUpdates() {
    this.checkCalls += 1;
    return this.checkResult;
  }

  downloadUpdate(token) {
    this.downloadCalls += 1;
    this.downloadToken = token;
    return this.downloadImpl();
  }

  quitAndInstall(...args) {
    this.installCalls.push(args);
  }
}

function enabledService(overrides = {}) {
  const updater = overrides.updater || new FakeUpdater();
  const service = createWindowsUpdateService({
    currentVersion: "0.2.0",
    existsSync: () => true,
    now: () => new Date("2026-08-18T10:00:00.000Z"),
    packaged: true,
    packagedSmoke: false,
    platform: "win32",
    resourcesPath: "C:/Program/HSL/resources",
    updater,
    ...overrides,
  });
  service.initialize();
  return { service, updater };
}

test("updater is disabled without every installed-NSIS condition and never loads a network updater", () => {
  const cases = [
    [{ packaged: false, platform: "win32", existsSync: () => true }, "development"],
    [{ packaged: true, platform: "linux", existsSync: () => true }, "non-windows"],
    [{ packaged: true, platform: "win32", packagedSmoke: true, existsSync: () => true }, "packaged-smoke"],
    [{ packaged: true, platform: "win32", existsSync: () => false }, "missing-app-update-config"],
  ];
  for (const [input, reason] of cases) {
    let loads = 0;
    const service = createWindowsUpdateService({
      ...input,
      currentVersion: "0.2.0",
      loadUpdater() { loads += 1; return new FakeUpdater(); },
      resourcesPath: "C:/resources",
    });
    service.initialize();
    assert.equal(service.getState().enabled, false);
    assert.equal(service.getState().enableReason, reason);
    assert.equal(loads, 0);
  }
  assert.equal(resolveWindowsUpdateEnablement({ packaged: true, platform: "win32", existsSync: () => true }).enabled, true);
});

test("electron-updater decisions are explicit and runtime channel is untouched", () => {
  let channelAssignments = 0;
  const updater = {};
  Object.defineProperty(updater, "channel", { set() { channelAssignments += 1; } });
  configureAutoUpdater(updater);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.disableDifferentialDownload, false);
  assert.equal(updater.disableWebInstaller, true);
  assert.equal(channelAssignments, 0);
});

test("interactive check is attempted exactly once and not-available returns to idle", async () => {
  const { service, updater } = enabledService();
  const first = service.checkOnce();
  assert.equal(service.getState().checkAttempted, true);
  assert.equal(service.getState().state, "checking");
  await first;
  await service.checkOnce();
  assert.equal(updater.checkCalls, 1);
  assert.equal(service.getState().state, "idle");
  assert.equal(service.getState().lastCheckAt, "2026-08-18T10:00:00.000Z");
});

test("available is public and sanitized; decline is process-only and never downloads", async () => {
  const { service, updater } = enabledService();
  updater.checkResult = { isUpdateAvailable: true };
  const checking = service.checkOnce();
  updater.emit("update-available", {
    version: "0.3.0",
    files: [{ url: "https://secret.invalid/installer.exe?token=bad" }],
    token: "bad",
  });
  await checking;
  const available = service.getState();
  assert.equal(available.state, "available");
  assert.equal(available.updateVersion, "0.3.0");
  assert.doesNotMatch(JSON.stringify(available), /secret|installer|token|https/i);
  service.decline();
  assert.equal(service.getState().declinedThisRun, true);
  assert.equal(service.getState().state, "idle");
  assert.equal(updater.downloadCalls, 0);
  assert.equal((await service.accept()).ok, false);
});

test("check error is silent public state with a sanitized code", async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async function checkForUpdates() {
    this.checkCalls += 1;
    const error = new Error("https://api.github.invalid/token/secret");
    error.code = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
    throw error;
  };
  const { service } = enabledService({ updater });
  await service.checkOnce();
  assert.equal(service.getState().state, "error");
  assert.equal(service.getState().lastErrorCode, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
  assert.doesNotMatch(JSON.stringify(service.getState()), /github\.invalid|secret|https/i);
  await service.checkOnce();
  assert.equal(updater.checkCalls, 1);
});

async function makeAvailable(service, updater) {
  updater.checkResult = { isUpdateAvailable: true };
  const checking = service.checkOnce();
  updater.emit("update-available", { version: "0.3.0" });
  await checking;
}

test("accept owns one download, sanitizes progress and installs once after update-downloaded", async () => {
  const updater = new FakeUpdater();
  const { service } = enabledService({ updater });
  await makeAvailable(service, updater);
  let releaseDownload;
  updater.downloadImpl = () => new Promise((resolve) => { releaseDownload = resolve; });
  const accepted = service.accept();
  const duplicate = service.accept();
  await Promise.resolve();
  assert.equal(accepted, duplicate);
  assert.equal(service.getState().state, "downloading");
  updater.emit("download-progress", { percent: 47.256, transferred: 123, total: 456 });
  assert.deepEqual(service.getState().progress, { percent: 47.3 });
  updater.emit("update-downloaded", {
    version: "0.3.0",
    downloadedFile: "C:/Users/user/AppData/secret-installer.exe",
  });
  updater.emit("update-downloaded", { version: "0.3.0" });
  releaseDownload([]);
  const result = await accepted;
  assert.equal(result.ok, true);
  assert.equal(service.getState().state, "installing");
  assert.deepEqual(updater.installCalls, [[true, true]]);
  assert.equal(updater.downloadCalls, 1);
  assert.doesNotMatch(JSON.stringify(service.getState()), /AppData|secret-installer/i);
});

test("download error returns a non-installing sanitized failure", async () => {
  const updater = new FakeUpdater();
  const { service } = enabledService({ updater });
  await makeAvailable(service, updater);
  updater.downloadImpl = async () => {
    const error = new Error("https://github.invalid/private/path");
    error.code = "ERR_UPDATER_DOWNLOAD";
    throw error;
  };
  const result = await service.accept();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "ERR_UPDATER_DOWNLOAD");
  assert.equal(service.getState().state, "error");
  assert.equal(updater.installCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /github\.invalid|private\/path|https/i);
});

test("normal exit wins over a late downloaded event and shutdown never installs", async () => {
  const updater = new FakeUpdater();
  let canInstall = true;
  const { service } = enabledService({ updater, canInstall: () => canInstall });
  await makeAvailable(service, updater);
  updater.downloadImpl = () => new Promise(() => {});
  const accepted = service.accept();
  canInstall = false;
  updater.emit("update-downloaded", { version: "0.3.0" });
  assert.equal((await accepted).errorCode, "UPDATE_INSTALL_SKIPPED_EXIT_IN_PROGRESS");
  assert.equal(updater.installCalls.length, 0);
  service.shutdown("normal-quit");
  updater.emit("update-downloaded", { version: "0.3.0" });
  assert.equal(updater.installCalls.length, 0);
});
