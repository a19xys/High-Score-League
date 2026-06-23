const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { addLibraryLocation } = require("../src/library-locations");
const { scanPackLibrary } = require("../src/pack-library");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-library-test-"));

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

function validPack(overrides = {}) {
  return {
    packVersion: 1,
    packId: "space-invaders-week-1",
    gameId: "space-invaders",
    rom: "invaders",
    weekId: "week-1",
    webBaseUrl: "https://high-score-league.example",
    mame: {
      relativeExecutablePath: "mame/mame.exe",
      workingDir: "mame",
      pluginName: "hsl-score",
    },
    ...overrides,
  };
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("escaneo detecta subcarpeta directa con pack.json", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    const packDir = path.join(libraryRoot, "Space Invaders");
    await writeJson(path.join(packDir, "pack.json"), validPack());
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 1);
    assert.equal(library.packs[0].packDir, packDir);
    assert.equal(library.packs[0].status, "ok");
  });
});

test("escaneo ignora subcarpetas sin pack.json", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await fsp.mkdir(path.join(libraryRoot, "No Pack"), { recursive: true });
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 0);
  });
});

test("escaneo devuelve error por pack invalido sin romper otros packs", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Valid", "pack.json"), validPack());
    await writeJson(path.join(libraryRoot, "Invalid", "pack.json"), { packVersion: 1 });
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 2);
    assert.equal(library.packs.filter((pack) => pack.status === "ok").length, 1);
    assert.equal(library.packs.filter((pack) => pack.status === "error").length, 1);
    assert.equal(library.totals.packsWithErrors, 1);
  });
});

test("escaneo no entra recursivamente mas de un nivel", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Nested", "Too Deep", "pack.json"), validPack());
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 0);
  });
});

test("pack detectado usa metadata.title como titulo", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    const packDir = path.join(libraryRoot, "Space Invaders");
    await writeJson(path.join(packDir, "pack.json"), validPack());
    await writeJson(path.join(packDir, "metadata.json"), {
      title: "Space Invaders Deluxe",
      subtitle: "Semana especial",
    });
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs[0].title, "Space Invaders Deluxe");
    assert.equal(library.packs[0].subtitle, "Semana especial");
  });
});

test("pack detectado expone cover e icon locales si existen", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    const packDir = path.join(libraryRoot, "Space Invaders");
    await writeJson(path.join(packDir, "pack.json"), validPack());
    await fsp.mkdir(path.join(packDir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(packDir, "assets", "cover.png"), "cover", "utf8");
    await fsp.writeFile(path.join(packDir, "assets", "icon.svg"), "<svg></svg>", "utf8");
    await writeJson(path.join(packDir, "metadata.json"), {
      assets: {
        cover: "assets/cover.png",
        icon: "assets/icon.svg",
      },
      title: "Space Invaders Deluxe",
    });
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs[0].cover.relativePath, "assets/cover.png");
    assert.equal(library.packs[0].cover.extension, ".png");
    assert.match(library.packs[0].cover.url, /^file:/);
    assert.equal(library.packs[0].icon.relativePath, "assets/icon.svg");
    assert.equal(library.packs[0].icon.extension, ".svg");
  });
});

test("pack detectado usa fallback sin metadata", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Space Invaders", "pack.json"), validPack({ packId: null }));
    await addLibraryLocation(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs[0].title, "space-invaders");
    assert.equal(library.packs[0].subtitle, "week-1");
  });
});

test("ubicacion inexistente genera warning", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "missing-library");
    await addLibraryLocation(config(dir), missing);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.locations[0].status, "missing");
    assert.match(library.locations[0].warnings[0], /no esta disponible/);
  });
});
