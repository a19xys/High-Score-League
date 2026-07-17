const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  acquireFileLock,
  readLock,
  removeVerifiedStaleLock,
} = require("../src/file-lock");

async function withTempDir(operation) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-file-lock-test-"));
  try {
    return await operation(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function writeOld(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
  const old = new Date(Date.now() - 10000);
  await fsp.utimes(filePath, old, old);
}

async function assertMissing(filePath) {
  await assert.rejects(() => fsp.access(filePath), (error) => error.code === "ENOENT");
}

test("stable old empty, truncated and malformed locks are recovered after stat grace", async () => {
  for (const [name, content] of [["empty", ""], ["truncated", "{\"pid\":"], ["malformed", "not-json"]]) {
    await withTempDir(async (root) => {
      const filePath = path.join(root, `${name}.lock`);
      await writeOld(filePath, content);
      const lock = await acquireFileLock(filePath, { malformedGraceMs: 5, retryMs: 1, timeoutMs: 200 });
      assert.equal((await readLock(filePath)).nonce, lock.nonce);
      assert.equal(await lock.release(), true);
      await assertMissing(filePath);
      assert.deepEqual(await fsp.readdir(root), []);
    });
  }
});

test("a recent malformed lock remains protected by its stat grace", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "recent.lock");
    await fsp.writeFile(filePath, "", "utf8");
    await assert.rejects(
      () => acquireFileLock(filePath, { malformedGraceMs: 1000, retryMs: 1, timeoutMs: 20 }),
      (error) => error.code === "SESSION_LOCK_TIMEOUT",
    );
    await fsp.access(filePath);
  });
});

test("a dead PID uses a short grace while a live PID is never removed", async () => {
  await withTempDir(async (root) => {
    const deadPath = path.join(root, "dead.lock");
    await writeOld(deadPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      nonce: "dead-owner",
      pid: 2147483647,
      schemaVersion: 1,
    }));
    const recovered = await acquireFileLock(deadPath, { deadPidGraceMs: 5, retryMs: 1, timeoutMs: 200 });
    await recovered.release();

    const livePath = path.join(root, "live.lock");
    await writeOld(livePath, JSON.stringify({ pid: process.pid }));
    await assert.rejects(
      () => acquireFileLock(livePath, { malformedGraceMs: 0, retryMs: 1, timeoutMs: 20 }),
      (error) => error.code === "SESSION_LOCK_TIMEOUT",
    );
    assert.equal((await readLock(livePath)).pid, process.pid);
  });
});

test("a failed record write cleans the partially acquired lock", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "partial.lock");
    await assert.rejects(
      () => acquireFileLock(filePath, {
        writeRecordImpl: async () => {
          throw Object.assign(new Error("injected write failure"), { code: "EIO" });
        },
      }),
      (error) => error.code === "EIO",
    );
    await assertMissing(filePath);
    assert.deepEqual(await fsp.readdir(root), []);
  });
});

test("waiting for a live lock can be aborted without waiting for timeout", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "abort.lock");
    const owner = await acquireFileLock(filePath);
    const controller = new AbortController();
    let reportWait;
    const waiting = new Promise((resolve) => { reportWait = resolve; });
    const contender = acquireFileLock(filePath, {
      onWait: reportWait,
      retryMs: 100,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    await waiting;
    controller.abort("shutdown");
    await assert.rejects(contender, (error) => error.code === "SESSION_LOCK_ABORTED" && error.reason === "shutdown");
    await owner.release();
  });
});

test("release is idempotent and never removes a replacement owner", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "ownership.lock");
    const first = await acquireFileLock(filePath);
    await fsp.unlink(filePath);
    const replacement = await acquireFileLock(filePath);
    assert.equal(await first.release(), false);
    assert.equal((await readLock(filePath)).nonce, replacement.nonce);
    assert.equal(await first.release(), false);
    assert.equal(await replacement.release(), true);
    assert.equal(await replacement.release(), false);
  });
});

test("release surfaces filesystem failures and can retry quarantine cleanup", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "release-error.lock");
    let failOnce = true;
    const lock = await acquireFileLock(filePath, {
      unlinkImpl: async (target) => {
        if (failOnce) {
          failOnce = false;
          throw Object.assign(new Error("injected access denied"), { code: "EACCES" });
        }
        return fsp.unlink(target);
      },
    });
    await assert.rejects(() => lock.release(), (error) => error.code === "EACCES");
    assert.equal(await lock.release(), true);
    assert.equal(await lock.release(), false);
    assert.deepEqual(await fsp.readdir(root), []);
  });
});

test("stale recovery restores a replacement moved during the quarantine race", async () => {
  await withTempDir(async (root) => {
    const filePath = path.join(root, "replacement-race.lock");
    const displacedPath = path.join(root, "displaced-old.lock");
    await writeOld(filePath, JSON.stringify({
      createdAt: "2000-01-01T00:00:00.000Z",
      nonce: "stale-owner",
      pid: 2147483647,
      schemaVersion: 1,
    }));
    const replacementRecord = {
      createdAt: new Date().toISOString(),
      nonce: "replacement-owner",
      pid: process.pid,
      schemaVersion: 1,
    };
    let swapped = false;
    const removed = await removeVerifiedStaleLock(filePath, {
      deadPidGraceMs: 0,
      renameImpl: async (source, destination) => {
        if (!swapped && source === filePath) {
          swapped = true;
          await fsp.rename(filePath, displacedPath);
          await fsp.writeFile(filePath, JSON.stringify(replacementRecord), "utf8");
        }
        return fsp.rename(source, destination);
      },
    });
    assert.equal(removed, false);
    assert.equal((await readLock(filePath)).nonce, replacementRecord.nonce);
    await fsp.access(displacedPath);
  });
});
