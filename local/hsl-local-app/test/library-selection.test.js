const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getLibrarySelectionFile,
  readLibrarySelection,
  readLibrarySelections,
  writeLibrarySelection,
} = require("../src/library-selection");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-library-selection-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("selection.json ausente devuelve selección vacía", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    const result = await readLibrarySelection(config, path.join(dir, "library"));

    assert.equal(result.selection, null);
    assert.equal(result.error, null);
    assert.equal(result.filePath, getLibrarySelectionFile(config));
  });
});

test("recuerda instanceKey y ruta relativa de forma independiente por biblioteca", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    const rootA = path.join(dir, "library-a");
    const rootB = path.join(dir, "library-b");
    const packA = { instanceKey: "instance_a", packDir: path.join(rootA, "Alpha") };
    const packB = { instanceKey: "instance_b", packDir: path.join(rootB, "Beta") };

    await writeLibrarySelection(config, rootA, packA, { updatedAt: "2026-07-13T10:00:00.000Z" });
    await writeLibrarySelection(config, rootB, packB, { updatedAt: "2026-07-13T11:00:00.000Z" });
    const [selectionA, selectionB, store] = await Promise.all([
      readLibrarySelection(config, rootA),
      readLibrarySelection(config, rootB),
      readLibrarySelections(config),
    ]);

    assert.equal(selectionA.selection.instanceKey, "instance_a");
    assert.equal(selectionA.selection.relativePackPath, "Alpha");
    assert.equal(selectionB.selection.instanceKey, "instance_b");
    assert.equal(selectionB.selection.relativePackPath, "Beta");
    assert.equal(Object.keys(store.selections).length, 2);
  });
});

test("rechaza recordar un pack fuera de la raíz actual", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    const libraryRoot = path.join(dir, "library");

    await assert.rejects(() => writeLibrarySelection(config, libraryRoot, {
      instanceKey: "instance_external",
      packDir: path.join(dir, "external", "Pack"),
    }), /no pertenece a la biblioteca actual/);
  });
});

test("selection.json corrupto no materializa una selección", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    const filePath = getLibrarySelectionFile(config);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, "{", "utf8");

    const result = await readLibrarySelection(config, path.join(dir, "library"));

    assert.equal(result.selection, null);
    assert.match(result.error, /selection\.json/);
  });
});
