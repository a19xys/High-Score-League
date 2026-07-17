const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { configureSessionProtection } = require("./secure-session-storage");

function unavailableProvider(reason) {
  const fail = () => { throw Object.assign(new Error("El proveedor seguro compartido entre GUI y CLI no esta disponible."), { code: "SESSION_STORAGE_UNAVAILABLE", cause: reason }); };
  return { degraded: true, encryptionAvailable: false, provider: "electron-unavailable", decryptString: fail, encryptString: fail };
}

function createElectronSafeStorageProvider(userDataDir) {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch (error) {
    return unavailableProvider(error);
  }
  const bridge = path.join(__dirname, "platform-safe-storage-bridge.cjs");
  function invoke(mode, input) {
    return execFileSync(electronPath, [bridge, mode, userDataDir || ""], {
      encoding: "utf8",
      input: String(input),
      timeout: 20000,
      windowsHide: true,
    }).trim();
  }
  return {
    encryptionAvailable: true,
    provider: `electron-${process.platform}`,
    decryptString(value) {
      return Buffer.from(invoke("decrypt", value), "base64").toString("utf8");
    },
    encryptString(value) {
      return invoke("encrypt", Buffer.from(String(value), "utf8").toString("base64"));
    },
  };
}

function createWindowsDpapiProvider(userDataDir) {
  return process.platform === "win32" ? createElectronSafeStorageProvider(userDataDir) : null;
}

function configureCliSessionProtection(config = {}) {
  return configureSessionProtection(createElectronSafeStorageProvider(config.userDataDir));
}

module.exports = {
  configureCliSessionProtection,
  createElectronSafeStorageProvider,
  createWindowsDpapiProvider,
};
