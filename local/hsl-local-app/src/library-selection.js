const fsp = require("node:fs/promises");
const path = require("node:path");
const { getDirectoryKey, normalizeDirectoryPath } = require("./pack-directory");

function getLibrarySelectionFile(config) {
  if (!config?.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para la selección de biblioteca.");
  }

  return path.join(config.userDataDir, "libraries", "selection.json");
}

function emptySelectionStore(overrides = {}) {
  return {
    error: null,
    filePath: overrides.filePath || null,
    schemaVersion: 1,
    selections: {},
    ...overrides,
  };
}

function normalizeSelectionEntry(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const instanceKey = typeof value.instanceKey === "string" && value.instanceKey.trim()
    ? value.instanceKey.trim()
    : null;
  const relativePackPath = typeof value.relativePackPath === "string" && value.relativePackPath.trim()
    ? value.relativePackPath.trim().replaceAll("\\", "/")
    : null;

  if (!instanceKey && !relativePackPath) {
    return null;
  }

  return {
    instanceKey,
    relativePackPath,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

async function readLibrarySelections(config) {
  const filePath = getLibrarySelectionFile(config);

  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    const selections = {};

    for (const [rootKey, value] of Object.entries(parsed?.selections || {})) {
      const entry = normalizeSelectionEntry(value);

      if (rootKey && entry) {
        selections[rootKey] = entry;
      }
    }

    return emptySelectionStore({ filePath, selections });
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptySelectionStore({ filePath });
    }

    return emptySelectionStore({
      error: `No se pudo leer selection.json: ${error.message}`,
      filePath,
    });
  }
}

async function readLibrarySelection(config, libraryRoot) {
  const rootPath = normalizeDirectoryPath(libraryRoot);
  const rootKey = getDirectoryKey(rootPath);
  const store = await readLibrarySelections(config);

  return {
    error: store.error,
    filePath: store.filePath,
    rootKey,
    rootPath,
    selection: rootKey ? store.selections[rootKey] || null : null,
  };
}

async function writeLibrarySelection(config, libraryRoot, pack, options = {}) {
  const rootPath = normalizeDirectoryPath(libraryRoot);
  const rootKey = getDirectoryKey(rootPath);

  if (!rootPath || !rootKey) {
    throw new Error("La raíz de biblioteca es obligatoria para recordar la selección.");
  }

  if (!pack?.instanceKey || !pack?.packDir) {
    throw new Error("La selección recordada debe ser una instancia real de pack.");
  }

  const relativePackPath = path.relative(rootPath, pack.packDir).replaceAll("\\", "/");

  if (!relativePackPath || relativePackPath.startsWith("../") || path.isAbsolute(relativePackPath)) {
    throw new Error("El pack seleccionado no pertenece a la biblioteca actual.");
  }

  const current = await readLibrarySelections(config);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const selection = {
    instanceKey: pack.instanceKey,
    relativePackPath,
    updatedAt,
  };
  const payload = {
    schemaVersion: 1,
    selections: {
      ...current.selections,
      [rootKey]: selection,
    },
    updatedAt,
  };

  await fsp.mkdir(path.dirname(current.filePath), { recursive: true });
  await fsp.writeFile(current.filePath, JSON.stringify(payload, null, 2), "utf8");

  return {
    filePath: current.filePath,
    rootKey,
    rootPath,
    selection,
  };
}

module.exports = {
  getLibrarySelectionFile,
  readLibrarySelection,
  readLibrarySelections,
  writeLibrarySelection,
};
