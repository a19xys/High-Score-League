const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getNonClashingPath,
  moveFileSafe,
  readFailureNote,
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
