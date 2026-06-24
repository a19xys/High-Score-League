const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setPackDirectory, writePackDirectory } = require("../src/pack-directory");
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

function validV2Pack(overrides = {}) {
  return {
    packVersion: 2,
    packId: "space-invaders-season-1-week-1",
    gameId: "space-invaders",
    rom: "invaders",
    seasonId: "season-1",
    seasonSlug: "season-1",
    seasonName: "Temporada 1",
    weekId: "week-1",
    weekNumber: 1,
    webBaseUrl: "https://high-score-league.example",
    runtime: {
      type: "mame",
      minVersion: "0.287",
      recommendedVersion: "0.287",
    },
    mame: {
      romPath: "roms",
      artworkPath: "artwork",
      samplePath: "samples",
      cfgPath: "cfg",
      launchArgs: [],
    },
    capture: {
      mode: "plugin",
      pluginName: "hsl-score",
      adapter: "scripts/space-invaders.lua",
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
    await writeJson(path.join(packDir, "pack.json"), validV2Pack());
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 1);
    assert.equal(library.packs[0].packDir, packDir);
    assert.equal(library.packs[0].status, "ok");
    assert.equal(library.packs[0].packVersion, 2);
    assert.equal(library.packs[0].contractStatus, "current");
  });
});

test("escaneo ignora subcarpetas sin pack.json", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await fsp.mkdir(path.join(libraryRoot, "No Pack"), { recursive: true });
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 0);
  });
});

test("escaneo devuelve error por pack invalido sin romper otros packs", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Valid", "pack.json"), validV2Pack());
    await writeJson(path.join(libraryRoot, "Invalid", "pack.json"), { packVersion: 2 });
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 2);
    assert.equal(library.packs.filter((pack) => pack.status === "ok").length, 1);
    assert.equal(library.packs.filter((pack) => pack.status === "error").length, 1);
    assert.equal(library.totals.packsWithErrors, 1);
  });
});

test("escaneo marca packVersion 1 como deprecated sin romper compatibilidad", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Legacy", "pack.json"), validPack());
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 1);
    assert.equal(library.packs[0].status, "warning");
    assert.equal(library.packs[0].deprecated, true);
    assert.equal(library.packs[0].contractStatus, "deprecated");
    assert.ok(library.packs[0].warnings.some((item) => /packVersion 1/i.test(item)));
  });
});

test("escaneo marca packVersion 2 invalido como requiere atencion", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Invalid V2", "pack.json"), validV2Pack({
      mame: {
        romPath: "../roms",
      },
    }));
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 1);
    assert.equal(library.packs[0].status, "error");
    assert.ok(library.packs[0].errors.some((item) => /mame\.romPath/.test(item)));
  });
});

test("escaneo no entra recursivamente mas de un nivel", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "Nested", "Too Deep", "pack.json"), validPack());
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 0);
  });
});

test("escaneo avisa si el directorio configurado parece un pack root", async () => {
  await withTempDir(async (dir) => {
    const packRoot = path.join(dir, "space-invaders");
    await writeJson(path.join(packRoot, "pack.json"), validPack());
    await writePackDirectory(config(dir), packRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 0);
    assert.equal(library.directory.status, "pack-root");
    assert.match(library.directory.warnings[0], /carpeta de pack/);
  });
});

test("escaneo ignora pack.json dentro de recursos del pack", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    await writeJson(path.join(libraryRoot, "space-invaders", "roms", "pack.json"), validPack());
    await writeJson(path.join(libraryRoot, "space-invaders", "assets", "pack.json"), validPack());
    await setPackDirectory(config(dir), libraryRoot);

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
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs[0].title, "Space Invaders Deluxe");
    assert.equal(library.packs[0].subtitle, "Semana especial");
  });
});

test("pack v2 expone temporada y metadata para vistas y filtros", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "library");
    const packDir = path.join(libraryRoot, "Space Invaders");
    await writeJson(path.join(packDir, "pack.json"), validV2Pack());
    await writeJson(path.join(packDir, "metadata.json"), {
      developer: "Taito",
      genre: ["Fixed shooter", "Arcade"],
      publisher: "Midway",
      shortDescription: "Defiende la Tierra.",
      title: "Space Invaders",
      year: 1978,
    });
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));
    const pack = library.packs[0];

    assert.equal(pack.seasonId, "season-1");
    assert.equal(pack.seasonName, "Temporada 1");
    assert.equal(pack.weekNumber, 1);
    assert.equal(pack.developer, "Taito");
    assert.equal(pack.publisher, "Midway");
    assert.equal(pack.year, 1978);
    assert.deepEqual(pack.genre, ["Fixed shooter", "Arcade"]);
    assert.equal(pack.shortDescription, "Defiende la Tierra.");
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
    await setPackDirectory(config(dir), libraryRoot);

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
    await setPackDirectory(config(dir), libraryRoot);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs[0].title, "space-invaders");
    assert.equal(library.packs[0].subtitle, "week-1");
  });
});

test("directorio inexistente genera warning", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "missing-library");
    await writePackDirectory(config(dir), missing);

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.directory.status, "missing");
    assert.match(library.directory.warnings[0], /No encuentro el directorio/);
  });
});
