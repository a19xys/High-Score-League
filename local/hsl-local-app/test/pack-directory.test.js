const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { addLibraryLocation, getLibraryLocationsFile } = require("../src/library-locations");
const {
  getPackDirectoryFile,
  normalizeDirectoryPath,
  readPackDirectory,
  setPackDirectory,
  writePackDirectory,
} = require("../src/pack-directory");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-directory-test-"));

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

test("pack-directory.json ausente devuelve estado sin directorio", async () => {
  await withTempDir(async (dir) => {
    const state = await readPackDirectory(config(dir));

    assert.equal(state.directoryPath, null);
    assert.equal(state.configured, false);
    assert.equal(state.available, false);
    assert.equal(state.reason, null);
    assert.equal(state.error, null);
    assert.equal(state.packDirectoryFile, path.join(dir, "userData", "libraries", "pack-directory.json"));
  });
});

test("pack-directory.json corrupto devuelve warning sin crashear", async () => {
  await withTempDir(async (dir) => {
    const file = getPackDirectoryFile(config(dir));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "{bad-json", "utf8");

    const state = await readPackDirectory(config(dir));

    assert.equal(state.directoryPath, null);
    assert.match(state.error, /pack-directory\.json/);
    assert.match(state.warnings[0], /pack-directory\.json/);
  });
});

test("guardar directorio crea pack-directory.json", async () => {
  await withTempDir(async (dir) => {
    const packsDir = path.join(dir, "packs");
    await fsp.mkdir(packsDir);

    const result = await setPackDirectory(config(dir), packsDir, {
      selectedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    const parsed = JSON.parse(await fsp.readFile(getPackDirectoryFile(config(dir)), "utf8"));

    assert.equal(result.ok, true);
    assert.equal(parsed.directoryPath, path.resolve(packsDir));
    assert.equal(parsed.selectedAt, "2026-06-20T00:00:00.000Z");
  });
});

test("cambiar directorio actualiza updatedAt y conserva selectedAt", async () => {
  await withTempDir(async (dir) => {
    const first = path.join(dir, "packs-a");
    const second = path.join(dir, "packs-b");
    await fsp.mkdir(first);
    await fsp.mkdir(second);

    await setPackDirectory(config(dir), first, {
      selectedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    await setPackDirectory(config(dir), second, {
      updatedAt: "2026-06-21T00:00:00.000Z",
    });
    const parsed = JSON.parse(await fsp.readFile(getPackDirectoryFile(config(dir)), "utf8"));

    assert.equal(parsed.directoryPath, path.resolve(second));
    assert.equal(parsed.selectedAt, "2026-06-20T00:00:00.000Z");
    assert.equal(parsed.updatedAt, "2026-06-21T00:00:00.000Z");
  });
});

test("normaliza rutas", () => {
  assert.equal(normalizeDirectoryPath("  ./packs  "), path.resolve("packs"));
});

test("guardar directorio no borra packs reales", async () => {
  await withTempDir(async (dir) => {
    const packsDir = path.join(dir, "packs");
    const existingPack = path.join(packsDir, "space-invaders");
    await fsp.mkdir(existingPack, { recursive: true });
    await fsp.writeFile(path.join(existingPack, "keep.txt"), "keep", "utf8");

    await setPackDirectory(config(dir), packsDir);

    assert.equal(await fsp.readFile(path.join(existingPack, "keep.txt"), "utf8"), "keep");
  });
});

test("detecta directorio inexistente", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "missing");
    await writePackDirectory(config(dir), missing, {
      selectedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    const state = await readPackDirectory(config(dir));

    assert.equal(state.directoryPath, path.resolve(missing));
    assert.equal(state.configured, true);
    assert.equal(state.exists, false);
    assert.equal(state.available, false);
    assert.equal(state.reason, "missing");
    assert.match(state.warnings[0], /No se encuentra el directorio/);
  });
});

test("detecta carpeta que parece pack root y no la guarda desde seleccion GUI", async () => {
  await withTempDir(async (dir) => {
    const packRoot = path.join(dir, "space-invaders");
    await fsp.mkdir(packRoot, { recursive: true });
    await fsp.writeFile(path.join(packRoot, "pack.json"), "{}", "utf8");

    const result = await setPackDirectory(config(dir), packRoot);

    assert.equal(result.ok, false);
    assert.equal(result.code, "pack_root_selected");
    await assert.rejects(() => fsp.access(getPackDirectoryFile(config(dir))));
  });
});

test("fallback desde locations.json con una ubicacion crea pack-directory.json", async () => {
  await withTempDir(async (dir) => {
    const packsDir = path.join(dir, "packs");
    await fsp.mkdir(packsDir);
    await addLibraryLocation(config(dir), packsDir, {
      addedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    const state = await readPackDirectory(config(dir), {
      now: "2026-06-21T00:00:00.000Z",
    });
    const parsed = JSON.parse(await fsp.readFile(getPackDirectoryFile(config(dir)), "utf8"));

    assert.equal(state.directoryPath, path.resolve(packsDir));
    assert.equal(state.legacyMigration, "created");
    assert.equal(parsed.directoryPath, path.resolve(packsDir));
    await fsp.access(getLibraryLocationsFile(config(dir)));
  });
});

test("fallback desde locations.json con varias ubicaciones genera warning sin migrar", async () => {
  await withTempDir(async (dir) => {
    const first = path.join(dir, "packs-a");
    const second = path.join(dir, "packs-b");
    await fsp.mkdir(first);
    await fsp.mkdir(second);
    await addLibraryLocation(config(dir), first, {
      addedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    await addLibraryLocation(config(dir), second, {
      addedAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    });

    const state = await readPackDirectory(config(dir));

    assert.equal(state.directoryPath, path.resolve(second));
    assert.equal(state.legacyLocationsDetected, 2);
    assert.equal(state.legacyMigration, "ambiguous");
    assert.match(state.warnings[0], /varias ubicaciones antiguas/);
    await assert.rejects(() => fsp.access(getPackDirectoryFile(config(dir))));
  });
});
