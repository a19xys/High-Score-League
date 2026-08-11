const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getNonClashingPath,
  moveFileSafe,
  movePendingToRejected,
  readFailureNote,
  readRejectionNote,
  reconcileLegacyGeneric409Failures,
  restoreBoxToPending,
  writeFailureNote,
} = require("../src/file-queue");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-queue-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("getNonClashingPath returns the original target when it is free", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "event.json");

    assert.equal(getNonClashingPath(target), target);
  });
});

test("getNonClashingPath adds a suffix when target already exists", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "event.json");
    await fsp.writeFile(target, "existing", "utf8");

    assert.equal(getNonClashingPath(target), path.join(dir, "event__2.json"));
  });
});

test("moveFileSafe does not overwrite an existing target", async () => {
  await withTempDir(async (dir) => {
    const source = path.join(dir, "source.json");
    const target = path.join(dir, "event.json");
    const expectedTarget = path.join(dir, "event__2.json");

    await fsp.writeFile(source, "new", "utf8");
    await fsp.writeFile(target, "existing", "utf8");

    const finalPath = await moveFileSafe(source, target);

    assert.equal(finalPath, expectedTarget);
    assert.equal(await fsp.readFile(target, "utf8"), "existing");
    assert.equal(await fsp.readFile(expectedTarget, "utf8"), "new");
    await assert.rejects(() => fsp.access(source));
  });
});

test("readFailureNote returns the stored failed reason", async () => {
  await withTempDir(async (dir) => {
    const config = {
      eventsFailedDirAbs: path.join(dir, "failed"),
    };
    await fsp.mkdir(config.eventsFailedDirAbs, { recursive: true });
    await writeFailureNote(config, "score.json", "HTTP 403: player is not joined to season");

    const note = await readFailureNote(config, "score.json");

    assert.equal(note.exists, true);
    assert.equal(note.reason, "HTTP 403: player is not joined to season");
    assert.match(note.failedAt, /^\d{4}-/);
  });
});

test("restoreBoxToPending restores failed without overwriting pending", async () => {
  await withTempDir(async (dir) => {
    const config = {
      eventsFailedDirAbs: path.join(dir, "failed"),
      eventsPendingDirAbs: path.join(dir, "pending"),
      eventsSentDirAbs: path.join(dir, "sent"),
    };
    await fsp.mkdir(config.eventsFailedDirAbs, { recursive: true });
    await fsp.mkdir(config.eventsPendingDirAbs, { recursive: true });
    await fsp.writeFile(path.join(config.eventsFailedDirAbs, "score.json"), "failed", "utf8");
    await fsp.writeFile(path.join(config.eventsPendingDirAbs, "score.json"), "pending", "utf8");

    const result = await restoreBoxToPending(config, "failed", "score.json");

    assert.equal(result.restoredFilename, "score__2.json");
    assert.equal(await fsp.readFile(path.join(config.eventsPendingDirAbs, "score.json"), "utf8"), "pending");
    assert.equal(await fsp.readFile(path.join(config.eventsPendingDirAbs, "score__2.json"), "utf8"), "failed");
    await assert.rejects(() => fsp.access(path.join(config.eventsFailedDirAbs, "score.json")));
  });
});

test("terminal domain rejection preserves JSON and writes only sanitized metadata", async () => {
  await withTempDir(async (dir) => {
    const config = {
      eventsPendingDirAbs: path.join(dir, "pending"),
      eventsRejectedDirAbs: path.join(dir, "rejected"),
    };
    await fsp.mkdir(config.eventsPendingDirAbs, { recursive: true });
    const source = path.join(config.eventsPendingDirAbs, "score.json");
    const original = JSON.stringify({ detectedAt: "2026-08-11T20:00:00Z", score: 123 });
    await fsp.writeFile(source, original, "utf8");

    const finalPath = await movePendingToRejected(config, "score.json", {
      domainCode: "WEEK_CLOSED_AT_DETECTION\nsecret=bad",
      httpStatus: 409,
      reason: "Rechazo competitivo definitivo",
      rejectedAt: "2026-08-11T23:10:00.000Z",
    });
    const note = await readRejectionNote(config, path.basename(finalPath));
    const noteRaw = await fsp.readFile(note.notePath, "utf8");

    assert.equal(await fsp.readFile(finalPath, "utf8"), original);
    assert.equal(note.httpStatus, "409");
    assert.equal(note.reason, "Rechazo competitivo definitivo");
    assert.doesNotMatch(noteRaw, /\nsecret=/);
    await assert.rejects(() => fsp.access(source));
  });
});

test("legacy generic HTTP 409 failed events are requeued once without touching conclusive failures", async () => {
  await withTempDir(async (dir) => {
    const config = {
      eventsFailedDirAbs: path.join(dir, "failed"),
      eventsPendingDirAbs: path.join(dir, "pending"),
    };
    await fsp.mkdir(config.eventsFailedDirAbs, { recursive: true });
    await fsp.mkdir(config.eventsPendingDirAbs, { recursive: true });
    await fsp.writeFile(path.join(config.eventsFailedDirAbs, "legacy.json"), "{}", "utf8");
    await writeFailureNote(config, "legacy.json", "HTTP 409: envio rechazado por el servicio.");
    await fsp.writeFile(path.join(config.eventsFailedDirAbs, "coded.json"), "{}", "utf8");
    await writeFailureNote(config, "coded.json", "HTTP 409: DUPLICATE_KEY_CONFLICT");

    assert.deepEqual(await reconcileLegacyGeneric409Failures(config), { inspected: 2, requeued: 1 });
    assert.deepEqual(await reconcileLegacyGeneric409Failures(config), { inspected: 1, requeued: 0 });
    assert.equal(await fsp.readFile(path.join(config.eventsPendingDirAbs, "legacy.json"), "utf8"), "{}");
    await assert.rejects(() => fsp.access(path.join(config.eventsFailedDirAbs, "legacy.json.failed.txt")));
    assert.equal(await fsp.readFile(path.join(config.eventsFailedDirAbs, "coded.json"), "utf8"), "{}");
  });
});
