const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const yazl = require("yazl");
const {
  DEFAULT_IMPORT_LIMITS,
  detectPackRootInFolder,
  importPackFromFolder,
  importPackFromZip,
  normalizeZipEntryName,
} = require("../src/pack-importer");
const { setPackDirectory } = require("../src/pack-directory");
const { scanPackLibrary } = require("../src/pack-library");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-importer-test-"));

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
      adapter: "scripts/invaders.lua",
    },
    ...overrides,
  };
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writePackFixture(packDir, options = {}) {
  const pack = validV2Pack(options.pack || {});
  const metadata = options.metadata === false
    ? null
    : {
        title: options.title || "Space Invaders",
        ...(options.metadata || {}),
      };
  const romPath = pack.mame.romPath || "roms";
  const adapter = pack.capture.adapter || "scripts/invaders.lua";

  await writeJson(path.join(packDir, "pack.json"), pack);

  if (metadata) {
    await writeJson(path.join(packDir, "metadata.json"), metadata);
  }

  await fsp.mkdir(path.join(packDir, romPath), { recursive: true });
  await fsp.writeFile(path.join(packDir, romPath, `${pack.rom}.zip`), "dummy rom", "utf8");
  await fsp.mkdir(path.dirname(path.join(packDir, adapter)), { recursive: true });
  await fsp.writeFile(path.join(packDir, adapter), "-- adapter", "utf8");
}

async function createZipFromDir(sourceDir, zipPath, prefix = "") {
  const zip = new yazl.ZipFile();

  async function addEntries(currentDir, relativeRoot = "") {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentDir, entry.name);
      const relativePath = path.posix.join(prefix, relativeRoot, entry.name);

      if (entry.isDirectory()) {
        zip.addEmptyDirectory(relativePath);
        await addEntries(sourcePath, path.posix.join(relativeRoot, entry.name));
      } else {
        zip.addFile(sourcePath, relativePath);
      }
    }
  }

  await fsp.mkdir(path.dirname(zipPath), { recursive: true });
  await addEntries(sourceDir);

  await new Promise((resolve, reject) => {
    zip.outputStream
      .pipe(require("node:fs").createWriteStream(zipPath))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}

async function createZip(zipPath, entries) {
  const zip = new yazl.ZipFile();

  for (const [entryPath, content] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(content), entryPath);
  }

  await new Promise((resolve, reject) => {
    zip.outputStream
      .pipe(require("node:fs").createWriteStream(zipPath))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}

async function setupLibrary(root) {
  const libraryRoot = path.join(root, "library");
  await fsp.mkdir(libraryRoot, { recursive: true });
  await setPackDirectory(config(root), libraryRoot);
  return libraryRoot;
}

async function tempNames(libraryRoot) {
  const entries = await fsp.readdir(libraryRoot).catch(() => []);
  return entries.filter((name) => name.startsWith(".hsl-import-"));
}

test("importa ZIP valido con carpeta raiz sin doble carpeta", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const sourcePack = path.join(dir, "source", "Space Invaders");
    const zipPath = path.join(dir, "SpaceInvaders.hslpack.zip");
    await writePackFixture(sourcePack);
    await createZipFromDir(sourcePack, zipPath, "Space Invaders");

    const result = await importPackFromZip(zipPath, config(dir));

    assert.equal(result.ok, true);
    assert.equal(result.packDir, path.join(libraryRoot, "Space Invaders"));
    assert.equal(await fsp.readFile(path.join(result.packDir, "pack.json"), "utf8").then(Boolean), true);
    await assert.rejects(fsp.stat(path.join(result.packDir, "Space Invaders", "pack.json")), /ENOENT/);
  });
});

test("importa ZIP valido con pack.json en raiz", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const sourcePack = path.join(dir, "source-root");
    const zipPath = path.join(dir, "root.zip");
    await writePackFixture(sourcePack, { title: "Root Pack" });
    await createZipFromDir(sourcePack, zipPath);

    const result = await importPackFromZip(zipPath, config(dir));

    assert.equal(result.ok, true);
    assert.equal(result.packDir, path.join(libraryRoot, "Root Pack"));
    assert.equal(await fsp.readFile(path.join(result.packDir, "scripts", "invaders.lua"), "utf8"), "-- adapter");
  });
});

test("importa carpeta que ya es pack root", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const sourcePack = path.join(dir, "external-pack");
    await writePackFixture(sourcePack, { title: "Folder Pack" });

    const result = await importPackFromFolder(sourcePack, config(dir));

    assert.equal(result.ok, true);
    assert.equal(result.packDir, path.join(libraryRoot, "Folder Pack"));
  });
});

test("importa carpeta contenedora con un unico pack", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const container = path.join(dir, "import");
    await writePackFixture(path.join(container, "Only Pack"), { title: "Only Pack" });

    const result = await importPackFromFolder(container, config(dir));

    assert.equal(result.ok, true);
    assert.equal(result.packDir, path.join(libraryRoot, "Only Pack"));
  });
});

test("rechaza ZIP sin pack.json", async () => {
  await withTempDir(async (dir) => {
    await setupLibrary(dir);
    const zipPath = path.join(dir, "empty.zip");
    await createZip(zipPath, { "readme.txt": "hello" });

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /No encuentro pack\.json/);
  });
});

test("rechaza ZIP con varios pack.json", async () => {
  await withTempDir(async (dir) => {
    await setupLibrary(dir);
    const zipPath = path.join(dir, "multi.zip");
    await createZip(zipPath, {
      "Space/pack.json": "{}",
      "Pac/pack.json": "{}",
    });

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /varios packs/);
  });
});

test("rechaza ZIP con pack.json demasiado profundo", async () => {
  await withTempDir(async (dir) => {
    await setupLibrary(dir);
    const zipPath = path.join(dir, "deep.zip");
    await createZip(zipPath, { "foo/bar/baz/pack.json": "{}" });

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /profundo/);
  });
});

test("rechaza pack.json invalido y limpia temporal", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const zipPath = path.join(dir, "bad-json.zip");
    await createZip(zipPath, { "pack.json": "{" });

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /pack\.json no es JSON valido/);
    assert.deepEqual(await tempNames(libraryRoot), []);
  });
});

test("rechaza packVersion distinto de 2", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const sourcePack = path.join(dir, "legacy");
    const zipPath = path.join(dir, "legacy.zip");
    await writeJson(path.join(sourcePack, "pack.json"), {
      packVersion: 1,
      gameId: "legacy",
      rom: "legacy",
      weekId: "week-1",
      webBaseUrl: "https://example.test",
      mame: {
        relativeExecutablePath: "mame/mame.exe",
        workingDir: "mame",
      },
    });
    await createZipFromDir(sourcePack, zipPath);

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /compatible/);
    assert.deepEqual(await tempNames(libraryRoot), []);
  });
});

test("validador rechaza rutas zip-slip y absolutas", () => {
  assert.throws(() => normalizeZipEntryName("../pack.json"), /rutas inseguras/);
  assert.throws(() => normalizeZipEntryName("/pack.json"), /rutas inseguras/);
  assert.throws(() => normalizeZipEntryName("C:\\pack.json"), /rutas inseguras/);
  assert.throws(() => normalizeZipEntryName("pack\u0000.json"), /rutas inseguras/);
});

test("rechaza ZIP corrupto", async () => {
  await withTempDir(async (dir) => {
    await setupLibrary(dir);
    const zipPath = path.join(dir, "corrupt.zip");
    await fsp.writeFile(zipPath, "not a zip", "utf8");

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /corrupto/);
  });
});

test("rechaza duplicado packId ya instalado y limpia temporal", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    await writePackFixture(path.join(libraryRoot, "Installed"));
    const sourcePack = path.join(dir, "duplicate");
    const zipPath = path.join(dir, "duplicate.zip");
    await writePackFixture(sourcePack, { title: "Duplicate Folder" });
    await createZipFromDir(sourcePack, zipPath);

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /mismo packId/);
    assert.deepEqual(await tempNames(libraryRoot), []);
  });
});

test("rechaza colision de carpeta destino y no sobrescribe", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    await fsp.mkdir(path.join(libraryRoot, "Space Invaders"), { recursive: true });
    await fsp.writeFile(path.join(libraryRoot, "Space Invaders", "keep.txt"), "keep", "utf8");
    const sourcePack = path.join(dir, "source");
    const zipPath = path.join(dir, "collision.zip");
    await writePackFixture(sourcePack, {
      pack: { packId: "other-pack" },
      title: "Space Invaders",
    });
    await createZipFromDir(sourcePack, zipPath);

    await assert.rejects(importPackFromZip(zipPath, config(dir)), /Ya existe un pack instalado/);
    assert.equal(await fsp.readFile(path.join(libraryRoot, "Space Invaders", "keep.txt"), "utf8"), "keep");
    assert.deepEqual(await tempNames(libraryRoot), []);
  });
});

test(".hsl-import no aparece como pack en biblioteca", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    await writePackFixture(path.join(libraryRoot, ".hsl-import-test-pack"));

    const library = await scanPackLibrary(config(dir));

    assert.equal(library.packs.length, 0);
  });
});

test("importar carpeta ya instalada no crea duplicado", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const installed = path.join(libraryRoot, "Installed");
    await writePackFixture(installed);

    const result = await importPackFromFolder(installed, config(dir));
    const library = await scanPackLibrary(config(dir));

    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.packDir, installed);
    assert.equal(library.packs.length, 1);
  });
});

test("importar mismo packId desde otra ruta se rechaza", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    await writePackFixture(path.join(libraryRoot, "Installed"));
    const external = path.join(dir, "external");
    await writePackFixture(external, { title: "External Same Id" });

    await assert.rejects(importPackFromFolder(external, config(dir)), /mismo packId/);
  });
});

test("romPath y capture.adapter personalizados se respetan", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const sourcePack = path.join(dir, "custom");
    await writePackFixture(sourcePack, {
      pack: {
        mame: {
          romPath: "custom-roms",
          artworkPath: "artwork",
          samplePath: "samples",
          cfgPath: "cfg",
          launchArgs: [],
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
          adapter: "custom-scripts/capture.lua",
        },
      },
      title: "Custom Paths",
    });

    const result = await importPackFromFolder(sourcePack, config(dir));

    assert.equal(result.packDir, path.join(libraryRoot, "Custom Paths"));
    assert.equal(await fsp.readFile(path.join(result.packDir, "custom-scripts", "capture.lua"), "utf8"), "-- adapter");
  });
});

test("temporal se limpia tras fallo de validacion", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = await setupLibrary(dir);
    const sourcePack = path.join(dir, "missing-adapter");
    await writePackFixture(sourcePack);
    await fsp.rm(path.join(sourcePack, "scripts", "invaders.lua"), { force: true });

    await assert.rejects(importPackFromFolder(sourcePack, config(dir)), /adaptador/);
    assert.deepEqual(await tempNames(libraryRoot), []);
  });
});

test("carpeta contenedora con varios packs se rechaza", async () => {
  await withTempDir(async (dir) => {
    const container = path.join(dir, "multi");
    await writePackFixture(path.join(container, "One"), { pack: { packId: "one" } });
    await writePackFixture(path.join(container, "Two"), { pack: { packId: "two" } });

    await assert.rejects(detectPackRootInFolder(container), /varios packs/);
  });
});

test("limites anti ZIP bomb rechazan demasiadas entradas", async () => {
  await withTempDir(async (dir) => {
    await setupLibrary(dir);
    const zipPath = path.join(dir, "many.zip");
    await createZip(zipPath, {
      "pack.json": JSON.stringify(validV2Pack()),
      "roms/invaders.zip": "rom",
      "scripts/invaders.lua": "lua",
      "extra-1.txt": "1",
      "extra-2.txt": "2",
    });

    await assert.rejects(
      importPackFromZip(zipPath, config(dir), { limits: { ...DEFAULT_IMPORT_LIMITS, maxEntries: 4 } }),
      /demasiados archivos/,
    );
  });
});
