const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadPack, validatePack } = require("../src/pack");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function validPack() {
  return {
    packVersion: 1,
    gameId: "space-invaders",
    rom: "invaders",
    weekId: "week-1",
    webBaseUrl: "https://high-score-league.vercel.app",
    mame: {
      relativeExecutablePath: "mame/mame.exe",
      workingDir: "mame",
      pluginName: "hsl-score",
    },
  };
}

test("validatePack accepts required pack fields", () => {
  assert.deepEqual(validatePack(validPack()), []);
});

test("validatePack rejects missing required fields", () => {
  const errors = validatePack({
    packVersion: 1,
  });

  assert.ok(errors.includes("pack.json debe incluir gameId"));
  assert.ok(errors.includes("pack.json debe incluir mame"));
});

test("loadPack loads and annotates pack root", async () => {
  await withTempDir(async (dir) => {
    const packPath = path.join(dir, "pack.json");
    await fsp.writeFile(packPath, JSON.stringify(validPack()), "utf8");

    const result = loadPack(packPath);

    assert.equal(result.loaded, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.pack.packRoot, dir);
    assert.equal(result.pack.rom, "invaders");
  });
});
