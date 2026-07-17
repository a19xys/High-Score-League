const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWindowsDpapiProvider } = require("../src/platform-session-protection");

test("Windows CLI protection round-trips through Electron safeStorage", { skip: process.platform !== "win32" }, async () => {
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-cli-safe-storage-"));
  try {
    const provider = createWindowsDpapiProvider(profile);
    const secret = "access-secret / refresh-secret / ñ";
    const encrypted = provider.encryptString(secret);
    assert.notEqual(encrypted, secret);
    assert.equal(provider.decryptString(encrypted), secret);
    assert.equal(provider.provider, "electron-win32");
  } finally {
    await fsp.rm(profile, { recursive: true, force: true });
  }
});

test("Electron GUI and CLI DPAPI providers decrypt each other's envelopes", { skip: process.platform !== "win32" }, async () => {
  const electron = require("electron");
  const helper = path.join(__dirname, "..", "test-support", "electron-safe-storage-compat.cjs");
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-electron-safe-storage-"));
  const provider = createWindowsDpapiProvider(profile);
  const invoke = (mode, input) => {
    const result = spawnSync(electron, [helper, mode, profile], {
      encoding: "utf8",
      input,
      timeout: 20000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    const secret = "canonical-session-secret";
    const cliEncrypted = provider.encryptString(secret);
    const electronDecrypted = Buffer.from(invoke("decrypt", cliEncrypted), "base64").toString("utf8");
    assert.equal(electronDecrypted, secret);
    const electronEncrypted = invoke("encrypt", Buffer.from(secret, "utf8").toString("base64"));
    assert.equal(provider.decryptString(electronEncrypted), secret);
  } finally {
    await fsp.rm(profile, { recursive: true, force: true });
  }
});
