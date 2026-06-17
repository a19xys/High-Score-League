const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { getNonClashingPath, moveFileSafe } = require("../src/file-queue");

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
