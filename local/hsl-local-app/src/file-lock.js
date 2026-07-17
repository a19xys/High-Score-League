const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLock(lockPath) {
  try {
    return JSON.parse(await fsp.readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function removeVerifiedStaleLock(lockPath, options = {}) {
  const value = await readLock(lockPath);
  const createdAtMs = Date.parse(value?.createdAt || "");
  const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : Infinity;
  const staleAfterMs = options.staleAfterMs ?? 120000;
  if (ageMs < staleAfterMs || isProcessAlive(Number(value?.pid))) return false;
  const check = await readLock(lockPath);
  if (!check || check.nonce !== value?.nonce) return false;
  await fsp.unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return true;
}

async function acquireFileLock(lockPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2000;
  const retryMs = options.retryMs ?? 25;
  const startedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  let reportedWait = false;
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    let handle;
    try {
      handle = await fsp.open(lockPath, "wx", 0o600);
      const record = {
        createdAt: new Date().toISOString(),
        nonce,
        pid: process.pid,
        purpose: options.purpose || "coordination",
        schemaVersion: 1,
        userHash: options.userHash || null,
      };
      await handle.writeFile(JSON.stringify(record, null, 2), "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      let released = false;
      return {
        lockPath,
        nonce,
        async release() {
          if (released) return;
          released = true;
          const current = await readLock(lockPath);
          if (current?.nonce === nonce) await fsp.unlink(lockPath).catch(() => {});
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      if (!reportedWait) {
        reportedWait = true;
        options.onWait?.();
      }
      if (await removeVerifiedStaleLock(lockPath, options)) continue;
      if (Date.now() - startedAt >= timeoutMs) {
        throw Object.assign(new Error("El lock de sesion esta ocupado."), {
          code: "SESSION_LOCK_TIMEOUT",
          retryable: true,
        });
      }
      await delay(Math.min(retryMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    }
  }
}

module.exports = {
  acquireFileLock,
  isProcessAlive,
  readLock,
  removeVerifiedStaleLock,
};
