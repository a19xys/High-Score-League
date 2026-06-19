const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  loadPack,
  loadPackFromDir,
  resolvePackMamePaths,
  validatePack,
} = require("../src/pack");

const FLAT_PACK_EXAMPLE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "examples",
  "pack.hsl-invaders-flat.example.json"
);

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

test("loadPackFromDir loads pack.json from an external pack directory", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validPack()), "utf8");

    const result = loadPackFromDir(dir);

    assert.equal(result.loaded, true);
    assert.equal(result.pack.packRoot, dir);
    assert.equal(result.pack.gameId, "space-invaders");
  });
});

test("loadPackFromDir reports missing pack.json clearly", async () => {
  await withTempDir(async (dir) => {
    const result = loadPackFromDir(dir);

    assert.equal(result.loaded, false);
    assert.equal(result.pack, null);
    assert.equal(result.errors.length, 0);
    assert.equal(result.packPath, path.join(dir, "pack.json"));
  });
});

test("resolvePackMamePaths resolves paths relative to external pack dir", () => {
  const mame = resolvePackMamePaths(validPack(), "C:/packs/HSL_SpaceInvaders_Semana12");

  assert.equal(mame.executablePath, path.resolve("C:/packs/HSL_SpaceInvaders_Semana12", "mame/mame.exe"));
  assert.equal(mame.workingDir, path.resolve("C:/packs/HSL_SpaceInvaders_Semana12", "mame"));
  assert.equal(mame.pluginName, "hsl-score");
});

test("flat hsl-invaders development pack example is a valid pack manifest", async () => {
  const raw = await fsp.readFile(FLAT_PACK_EXAMPLE_PATH, "utf8");
  const pack = JSON.parse(raw);

  assert.deepEqual(validatePack(pack), []);
  assert.equal(pack.mame.relativeExecutablePath, "mame.exe");
  assert.equal(pack.mame.workingDir, ".");
});

test("flat hsl-invaders development pack resolves MAME paths from the pack root", async () => {
  const raw = await fsp.readFile(FLAT_PACK_EXAMPLE_PATH, "utf8");
  const pack = JSON.parse(raw);
  const packRoot = "C:/Users/u/Downloads/hsl-invaders";
  const mame = resolvePackMamePaths(pack, packRoot);

  assert.equal(mame.executablePath, path.resolve(packRoot, "mame.exe"));
  assert.equal(mame.workingDir, path.resolve(packRoot, "."));
  assert.equal(mame.pluginName, "hsl-score");
});
