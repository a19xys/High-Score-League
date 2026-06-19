const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  clearLastOpenedPack,
  getRecentPacksFile,
  readRecentPackState,
  writeLastOpenedPack,
} = require("../src/recent-packs");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-recent-packs-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function config(root) {
  return {
    userDataDir: path.join(root, "userData"),
  };
}

test("readRecentPackState returns empty state when recent.json does not exist", async () => {
  await withTempDir(async (dir) => {
    const state = await readRecentPackState(config(dir));

    assert.equal(state.lastOpenedPackDir, null);
    assert.equal(state.updatedAt, null);
    assert.equal(state.error, null);
    assert.equal(state.recentPacksFile, path.join(dir, "userData", "packs", "recent.json"));
  });
});

test("writeLastOpenedPack creates packs directory and persists last pack", async () => {
  await withTempDir(async (dir) => {
    const packDir = path.join(dir, "packs", "hsl-invaders");
    const written = await writeLastOpenedPack(config(dir), packDir, {
      updatedAt: "2026-06-19T00:00:00.000Z",
    });
    const raw = await fsp.readFile(getRecentPacksFile(config(dir)), "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(written.lastOpenedPackDir, packDir);
    assert.equal(parsed.lastOpenedPackDir, packDir);
    assert.equal(parsed.updatedAt, "2026-06-19T00:00:00.000Z");
  });
});

test("readRecentPackState reads a previously written pack", async () => {
  await withTempDir(async (dir) => {
    const packDir = path.join(dir, "packs", "hsl-invaders");
    await writeLastOpenedPack(config(dir), packDir, {
      updatedAt: "2026-06-19T00:00:00.000Z",
    });

    const state = await readRecentPackState(config(dir));

    assert.equal(state.lastOpenedPackDir, packDir);
    assert.equal(state.updatedAt, "2026-06-19T00:00:00.000Z");
    assert.equal(state.error, null);
  });
});

test("readRecentPackState handles corrupt JSON without throwing", async () => {
  await withTempDir(async (dir) => {
    const file = getRecentPacksFile(config(dir));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "{", "utf8");

    const state = await readRecentPackState(config(dir));

    assert.equal(state.lastOpenedPackDir, null);
    assert.match(state.error, /No se pudo leer recent\.json/);
  });
});

test("clearLastOpenedPack keeps recent file but removes active path", async () => {
  await withTempDir(async (dir) => {
    const packDir = path.join(dir, "packs", "hsl-invaders");
    await writeLastOpenedPack(config(dir), packDir);
    await clearLastOpenedPack(config(dir), {
      updatedAt: "2026-06-19T00:00:00.000Z",
    });

    const state = await readRecentPackState(config(dir));

    assert.equal(state.lastOpenedPackDir, null);
    assert.equal(state.updatedAt, "2026-06-19T00:00:00.000Z");
  });
});
