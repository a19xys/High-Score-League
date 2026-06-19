const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  addLibraryLocation,
  getLibraryLocationsFile,
  readLibraryLocations,
  removeLibraryLocation,
} = require("../src/library-locations");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-library-locations-test-"));

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

test("locations.json ausente devuelve lista vacia", async () => {
  await withTempDir(async (dir) => {
    const state = await readLibraryLocations(config(dir));

    assert.deepEqual(state.locations, []);
    assert.equal(state.error, null);
    assert.equal(state.locationsFile, path.join(dir, "userData", "libraries", "locations.json"));
  });
});

test("anadir ubicacion crea locations.json", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "packs");
    await fsp.mkdir(libraryRoot);

    const result = await addLibraryLocation(config(dir), libraryRoot, {
      addedAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    });
    const raw = await fsp.readFile(getLibraryLocationsFile(config(dir)), "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(result.added, true);
    assert.equal(result.duplicate, false);
    assert.equal(parsed.locations.length, 1);
    assert.equal(parsed.locations[0].path, path.resolve(libraryRoot));
  });
});

test("anadir ubicacion duplicada no duplica", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "packs");
    await fsp.mkdir(libraryRoot);

    await addLibraryLocation(config(dir), libraryRoot);
    const duplicate = await addLibraryLocation(config(dir), `${libraryRoot}${path.sep}`);

    assert.equal(duplicate.added, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.state.locations.length, 1);
  });
});

test("locations.json corrupto no crashea", async () => {
  await withTempDir(async (dir) => {
    const locationsFile = getLibraryLocationsFile(config(dir));
    await fsp.mkdir(path.dirname(locationsFile), { recursive: true });
    await fsp.writeFile(locationsFile, "{bad-json", "utf8");

    const state = await readLibraryLocations(config(dir));

    assert.deepEqual(state.locations, []);
    assert.match(state.error, /locations\.json/);
  });
});

test("quitar ubicacion elimina solo de JSON", async () => {
  await withTempDir(async (dir) => {
    const libraryRoot = path.join(dir, "packs");
    await fsp.mkdir(libraryRoot);
    const added = await addLibraryLocation(config(dir), libraryRoot);

    const removed = await removeLibraryLocation(config(dir), added.location.id);

    assert.equal(removed.removed, true);
    assert.deepEqual(removed.state.locations, []);
    const stat = await fsp.stat(libraryRoot);
    assert.equal(stat.isDirectory(), true);
  });
});
