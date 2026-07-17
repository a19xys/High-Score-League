const crypto = require("node:crypto");
const { constants: fsConstants } = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const DEFAULT_DEAD_PID_GRACE_MS = 1000;
const DEFAULT_MALFORMED_GRACE_MS = 1000;

function createAbortError(signal) {
  const error = new Error("La espera del lock de sesion fue cancelada.");
  error.name = "AbortError";
  error.code = "SESSION_LOCK_ABORTED";
  error.reason = signal?.reason;
  error.retryable = false;
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError(signal);
}

function delay(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError(signal));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
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

async function readLockState(lockPath) {
  let stat;
  try {
    stat = await fsp.stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, lockPath };
    throw error;
  }

  let raw;
  try {
    raw = await fsp.readFile(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, lockPath };
    throw error;
  }

  try {
    return { exists: true, lockPath, raw, stat, value: JSON.parse(raw) };
  } catch (parseError) {
    return { exists: true, lockPath, parseError, raw, stat, value: null };
  }
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  const leftInode = Number(left.ino);
  const rightInode = Number(right.ino);
  const leftDevice = Number(left.dev);
  const rightDevice = Number(right.dev);
  if (Number.isFinite(leftInode) && Number.isFinite(rightInode) && (leftInode !== 0 || rightInode !== 0)) {
    return leftInode === rightInode && leftDevice === rightDevice;
  }
  return Number(left.birthtimeMs) === Number(right.birthtimeMs) && Number(left.size) === Number(right.size);
}

function sameStableState(left, right) {
  return Boolean(left?.exists && right?.exists
    && left.raw === right.raw
    && sameFileIdentity(left.stat, right.stat)
    && Number(left.stat.size) === Number(right.stat.size)
    && Number(left.stat.mtimeMs) === Number(right.stat.mtimeMs)
    && Number(left.stat.ctimeMs) === Number(right.stat.ctimeMs));
}

function sameQuarantinedState(expected, quarantined) {
  return Boolean(expected?.exists && quarantined?.exists
    && expected.raw === quarantined.raw
    && sameFileIdentity(expected.stat, quarantined.stat)
    && Number(expected.stat.size) === Number(quarantined.stat.size)
    && Number(expected.stat.mtimeMs) === Number(quarantined.stat.mtimeMs));
}

function nonNegativeMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function graceMs(options, specificName, fallback) {
  if (options[specificName] !== undefined) return nonNegativeMs(options[specificName], fallback);
  if (options.staleAfterMs !== undefined) return nonNegativeMs(options.staleAfterMs, fallback);
  return fallback;
}

function lockAgeMs(state, options = {}) {
  const currentTime = typeof options.now === "function" ? options.now() : Date.now();
  return Math.max(0, Number(currentTime) - Number(state.stat.mtimeMs));
}

async function unlinkStrict(filePath, options = {}) {
  const unlinkImpl = options.unlinkImpl || fsp.unlink;
  try {
    await unlinkImpl(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function restoreQuarantinedLock(quarantinePath, lockPath, options = {}) {
  const copyFileImpl = options.copyFileImpl || fsp.copyFile;
  try {
    await copyFileImpl(quarantinePath, lockPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const recoveryError = Object.assign(new Error("El lock cambio durante su recuperacion y no se pudo restaurar sin sobrescribir otro propietario."), {
      cause: error,
      code: "SESSION_LOCK_RECOVERY_RACE",
      lockPath,
      quarantinePath,
    });
    throw recoveryError;
  }
  await unlinkStrict(quarantinePath, options);
}

async function quarantineIfUnchanged(lockPath, expectedState, options = {}) {
  const quarantinePath = `${lockPath}.quarantine-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const renameImpl = options.renameImpl || fsp.rename;
  try {
    await renameImpl(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    throw error;
  }

  const quarantined = await readLockState(quarantinePath);
  if (sameQuarantinedState(expectedState, quarantined)) {
    return { quarantinePath, status: "quarantined" };
  }

  await restoreQuarantinedLock(quarantinePath, lockPath, options);
  return { status: "replaced" };
}

async function removeVerifiedStaleLock(lockPath, options = {}) {
  throwIfAborted(options.signal);
  const first = await readLockState(lockPath);
  if (!first.exists) return true;

  const pid = Number(first.value?.pid);
  if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) return false;
  const ownerWasRecorded = Number.isInteger(pid) && pid > 0;
  const requiredGraceMs = ownerWasRecorded
    ? graceMs(options, "deadPidGraceMs", DEFAULT_DEAD_PID_GRACE_MS)
    : graceMs(options, "malformedGraceMs", DEFAULT_MALFORMED_GRACE_MS);
  if (lockAgeMs(first, options) < requiredGraceMs) return false;

  // A second stat+read prevents a partially-written or actively-changing file
  // from being classified by a single malformed snapshot.
  await Promise.resolve();
  throwIfAborted(options.signal);
  const second = await readLockState(lockPath);
  if (!second.exists) return true;
  if (!sameStableState(first, second)) return false;
  const secondPid = Number(second.value?.pid);
  if (Number.isInteger(secondPid) && secondPid > 0 && isProcessAlive(secondPid)) return false;
  if (lockAgeMs(second, options) < requiredGraceMs) return false;

  const quarantined = await quarantineIfUnchanged(lockPath, second, options);
  if (quarantined.status === "missing") return true;
  if (quarantined.status === "replaced") return false;
  await unlinkStrict(quarantined.quarantinePath, options);
  return true;
}

async function cleanupPartialAcquisition(lockPath, createdStat, options = {}) {
  if (!createdStat) return false;
  const current = await readLockState(lockPath);
  if (!current.exists) return true;
  if (!sameFileIdentity(createdStat, current.stat)) return false;
  const quarantined = await quarantineIfUnchanged(lockPath, current, options);
  if (quarantined.status === "quarantined") await unlinkStrict(quarantined.quarantinePath, options);
  return quarantined.status !== "replaced";
}

function attachCleanupError(error, cleanupError) {
  if (!cleanupError) return error;
  try {
    error.lockCleanupError = cleanupError;
  } catch {}
  return error;
}

async function acquireFileLock(lockPath, options = {}) {
  const timeoutMs = nonNegativeMs(options.timeoutMs, 2000);
  const retryMs = Math.max(1, nonNegativeMs(options.retryMs, 25));
  const startedAt = performance.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  let reportedWait = false;
  throwIfAborted(options.signal);
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    throwIfAborted(options.signal);
    let handle;
    let created = false;
    let createdStat = null;
    try {
      handle = await fsp.open(lockPath, "wx", 0o600);
      created = true;
      createdStat = await handle.stat();
      const record = {
        createdAt: new Date().toISOString(),
        nonce,
        pid: process.pid,
        purpose: options.purpose || "coordination",
        schemaVersion: 1,
        userHash: options.userHash || null,
      };
      const encodedRecord = JSON.stringify(record, null, 2);
      if (options.writeRecordImpl) await options.writeRecordImpl(handle, encodedRecord, record);
      else await handle.writeFile(encodedRecord, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;

      const acquiredState = await readLockState(lockPath);
      if (!acquiredState.exists || acquiredState.value?.nonce !== nonce || !sameFileIdentity(createdStat, acquiredState.stat)) {
        throw Object.assign(new Error("No se pudo verificar la propiedad del lock adquirido."), { code: "SESSION_LOCK_VERIFY_FAILED" });
      }

      let pendingQuarantine = null;
      let released = false;
      return {
        lockPath,
        nonce,
        async release() {
          if (released) return false;
          if (pendingQuarantine) {
            await unlinkStrict(pendingQuarantine, options);
            pendingQuarantine = null;
            released = true;
            return true;
          }

          const current = await readLockState(lockPath);
          if (!current.exists) {
            released = true;
            return false;
          }
          if (current.value?.nonce !== nonce || !sameFileIdentity(acquiredState.stat, current.stat)) {
            released = true;
            return false;
          }

          const quarantined = await quarantineIfUnchanged(lockPath, current, options);
          if (quarantined.status !== "quarantined") {
            released = true;
            return false;
          }
          pendingQuarantine = quarantined.quarantinePath;
          await unlinkStrict(pendingQuarantine, options);
          pendingQuarantine = null;
          released = true;
          return true;
        },
      };
    } catch (error) {
      let cleanupError = null;
      try {
        await handle?.close();
      } catch (closeError) {
        cleanupError = closeError;
      }
      if (created) {
        try {
          await cleanupPartialAcquisition(lockPath, createdStat, options);
        } catch (partialCleanupError) {
          cleanupError ||= partialCleanupError;
        }
      }
      if (created || error?.code !== "EEXIST") throw attachCleanupError(error, cleanupError);
      if (!reportedWait) {
        reportedWait = true;
        options.onWait?.();
      }
      if (await removeVerifiedStaleLock(lockPath, options)) continue;
      throwIfAborted(options.signal);
      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw Object.assign(new Error("El lock de sesion esta ocupado."), {
          code: "SESSION_LOCK_TIMEOUT",
          retryable: true,
        });
      }
      await delay(Math.min(retryMs, Math.max(1, timeoutMs - elapsedMs)), options.signal);
    }
  }
}

module.exports = {
  acquireFileLock,
  isProcessAlive,
  readLock,
  removeVerifiedStaleLock,
};
