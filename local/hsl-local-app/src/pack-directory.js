const fsp = require("node:fs/promises");
const path = require("node:path");
const { readLibraryLocations } = require("./library-locations");

const LIBRARY_ROOT_CLASSIFICATIONS = Object.freeze({
  INSIDE_PACK: "inside-pack",
  INACCESSIBLE: "inaccessible",
  INVALID_FILE: "invalid-file",
  MISSING: "missing",
  PACK_ROOT: "pack-root",
  UNSUPPORTED_LAYOUT: "unsupported-layout",
  VALID_EMPTY_ROOT: "valid-empty-root",
  VALID_POPULATED_ROOT: "valid-populated-root",
});
const ROOT_INSPECTION_MAX_DEPTH = 4;
const ROOT_INSPECTION_MAX_ENTRIES = 512;

function getPackDirectoryFile(config) {
  if (!config?.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para pack directory.");
  }

  return path.join(config.userDataDir, "libraries", "pack-directory.json");
}

function normalizeDirectoryPath(directoryPath) {
  if (typeof directoryPath !== "string" || directoryPath.trim() === "") {
    return null;
  }

  return path.resolve(directoryPath.trim());
}

function getDirectoryKey(directoryPath, platform = process.platform) {
  const normalized = normalizeDirectoryPath(directoryPath);

  if (!normalized) {
    return null;
  }

  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function emptyPackDirectoryState(overrides = {}) {
  return {
    available: false,
    configured: false,
    directoryPath: null,
    error: null,
    exists: false,
    legacyLocationsDetected: 0,
    legacyLocationsFile: null,
    legacyMigration: "none",
    looksLikePackRoot: false,
    packDirectoryFile: overrides.packDirectoryFile || null,
    reason: null,
    schemaVersion: 1,
    selectedAt: null,
    source: "empty",
    updatedAt: null,
    warnings: [],
    ...overrides,
  };
}

async function pathInfo(targetPath) {
  if (!targetPath) {
    return {
      exists: false,
      errorCode: null,
      isDirectory: false,
      isFile: false,
    };
  }

  try {
    const stat = await fsp.stat(targetPath);

    return {
      exists: true,
      errorCode: null,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
    };
  } catch (error) {
    return {
      exists: false,
      errorCode: error?.code || "UNKNOWN",
      isDirectory: false,
      isFile: false,
    };
  }
}

async function directoryLooksLikePackRoot(directoryPath) {
  const info = await pathInfo(path.join(directoryPath, "pack.json"));
  return info.exists && info.isFile;
}

function isValidLibraryRootClassification(classification) {
  return classification === LIBRARY_ROOT_CLASSIFICATIONS.VALID_EMPTY_ROOT ||
    classification === LIBRARY_ROOT_CLASSIFICATIONS.VALID_POPULATED_ROOT;
}

function isMissingError(error) {
  return ["ENOENT", "ENOTDIR"].includes(error?.code);
}

async function safeRealpath(candidatePath, options = {}) {
  try {
    return await (options.realpathImpl || fsp.realpath)(candidatePath);
  } catch {
    return candidatePath;
  }
}

async function isRegularPackManifest(directoryPath, options = {}) {
  try {
    const stat = await (options.lstatImpl || fsp.lstat)(path.join(directoryPath, "pack.json"));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function inspectableDirectoryEntry(entry) {
  return entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".hsl-import-");
}

async function findDirectPackChildren(directoryPath, entries, options = {}) {
  const packDirectories = [];

  for (const entry of entries) {
    if (!inspectableDirectoryEntry(entry)) {
      continue;
    }

    const childPath = path.join(directoryPath, entry.name);

    if (await isRegularPackManifest(childPath, options)) {
      packDirectories.push(childPath);
    }
  }

  return packDirectories;
}

async function findNestedPack(directoryPath, rootEntries, options = {}) {
  const maxDepth = options.maxInspectionDepth || ROOT_INSPECTION_MAX_DEPTH;
  const maxEntries = options.maxInspectionEntries || ROOT_INSPECTION_MAX_ENTRIES;
  const queue = rootEntries
    .filter(inspectableDirectoryEntry)
    .map((entry) => ({ depth: 1, directoryPath: path.join(directoryPath, entry.name) }));
  let inspectedEntries = rootEntries.length;

  while (queue.length > 0 && inspectedEntries <= maxEntries) {
    const current = queue.shift();

    if (current.depth > 1 && await isRegularPackManifest(current.directoryPath, options)) {
      return current.directoryPath;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    let entries;

    try {
      entries = await (options.readdirImpl || fsp.readdir)(current.directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }

    inspectedEntries += entries.length;

    for (const entry of entries) {
      if (!inspectableDirectoryEntry(entry)) {
        continue;
      }

      queue.push({
        depth: current.depth + 1,
        directoryPath: path.join(current.directoryPath, entry.name),
      });
    }
  }

  return null;
}

async function findNearestPackAncestor(candidatePath, options = {}) {
  const volumeRoot = path.parse(candidatePath).root;
  let current = path.dirname(candidatePath);

  while (current) {
    if (await isRegularPackManifest(current, options)) {
      return current;
    }

    if (current === volumeRoot || current === path.dirname(current)) {
      break;
    }

    current = path.dirname(current);
  }

  return null;
}

async function classifyLibraryRootCandidateInternal(directoryPath, options = {}, includeSuggestion = true) {
  const candidatePath = normalizeDirectoryPath(directoryPath);
  const base = {
    candidatePath,
    classification: LIBRARY_ROOT_CLASSIFICATIONS.MISSING,
    directPackPaths: [],
    nestedPackPath: null,
    ok: false,
    packRootPath: null,
    resolvedPath: candidatePath,
    suggestedRootPath: null,
  };

  if (!candidatePath) {
    return base;
  }

  let stat;

  try {
    stat = await (options.statImpl || fsp.stat)(candidatePath);
  } catch (error) {
    return {
      ...base,
      classification: isMissingError(error)
        ? LIBRARY_ROOT_CLASSIFICATIONS.MISSING
        : LIBRARY_ROOT_CLASSIFICATIONS.INACCESSIBLE,
      errorCode: error?.code || "UNKNOWN",
    };
  }

  if (!stat.isDirectory()) {
    return {
      ...base,
      classification: LIBRARY_ROOT_CLASSIFICATIONS.INVALID_FILE,
      resolvedPath: await safeRealpath(candidatePath, options),
    };
  }

  const resolvedPath = await safeRealpath(candidatePath, options);

  if (await isRegularPackManifest(resolvedPath, options)) {
    const result = {
      ...base,
      classification: LIBRARY_ROOT_CLASSIFICATIONS.PACK_ROOT,
      packRootPath: resolvedPath,
      resolvedPath,
    };

    if (includeSuggestion) {
      const parent = path.dirname(resolvedPath);
      const parentResult = await classifyLibraryRootCandidateInternal(parent, options, false);

      if (isValidLibraryRootClassification(parentResult.classification)) {
        result.suggestedRootPath = parentResult.candidatePath;
      }
    }

    return result;
  }

  const packRootPath = await findNearestPackAncestor(resolvedPath, options);

  if (packRootPath) {
    const result = {
      ...base,
      classification: LIBRARY_ROOT_CLASSIFICATIONS.INSIDE_PACK,
      packRootPath,
      resolvedPath,
    };

    if (includeSuggestion) {
      const parent = path.dirname(packRootPath);
      const parentResult = await classifyLibraryRootCandidateInternal(parent, options, false);

      if (isValidLibraryRootClassification(parentResult.classification)) {
        result.suggestedRootPath = parentResult.candidatePath;
      }
    }

    return result;
  }

  let entries;

  try {
    entries = await (options.readdirImpl || fsp.readdir)(resolvedPath, { withFileTypes: true });
  } catch (error) {
    return {
      ...base,
      classification: LIBRARY_ROOT_CLASSIFICATIONS.INACCESSIBLE,
      errorCode: error?.code || "UNKNOWN",
      resolvedPath,
    };
  }

  const directPackPaths = await findDirectPackChildren(resolvedPath, entries, options);

  if (directPackPaths.length > 0) {
    return {
      ...base,
      classification: LIBRARY_ROOT_CLASSIFICATIONS.VALID_POPULATED_ROOT,
      directPackPaths,
      ok: true,
      resolvedPath,
    };
  }

  const nestedPackPath = await findNestedPack(resolvedPath, entries, options);

  if (nestedPackPath) {
    return {
      ...base,
      classification: LIBRARY_ROOT_CLASSIFICATIONS.UNSUPPORTED_LAYOUT,
      nestedPackPath,
      resolvedPath,
    };
  }

  return {
    ...base,
    classification: LIBRARY_ROOT_CLASSIFICATIONS.VALID_EMPTY_ROOT,
    ok: true,
    resolvedPath,
  };
}

async function classifyLibraryRootCandidate(directoryPath, options = {}) {
  return classifyLibraryRootCandidateInternal(directoryPath, options, true);
}

async function annotateDirectoryState(state) {
  const warnings = [...(state.warnings || [])];

  if (!state.directoryPath) {
    return emptyPackDirectoryState({
      ...state,
      warnings,
    });
  }

  const candidate = await classifyLibraryRootCandidate(state.directoryPath);
  const classification = candidate.classification;
  const validRoot = isValidLibraryRootClassification(classification);
  const missing = classification === LIBRARY_ROOT_CLASSIFICATIONS.MISSING;
  const inaccessible = classification === LIBRARY_ROOT_CLASSIFICATIONS.INACCESSIBLE ||
    classification === LIBRARY_ROOT_CLASSIFICATIONS.INVALID_FILE;
  const looksLikePackRoot = classification === LIBRARY_ROOT_CLASSIFICATIONS.PACK_ROOT;

  if (missing) {
    warnings.push("No se encuentra el directorio de packs. Recupera la carpeta o cambia la ubicación de la biblioteca.");
  } else if (inaccessible) {
    warnings.push("No puedo acceder al directorio de packs. Comprueba que la unidad esté conectada o cambia la ubicación de la biblioteca.");
  } else if (looksLikePackRoot) {
    warnings.push("Parece que has elegido una carpeta de pack. Elige la carpeta que contiene todos tus packs.");
  } else if (classification === LIBRARY_ROOT_CLASSIFICATIONS.INSIDE_PACK) {
    warnings.push("La carpeta configurada forma parte de un pack. Elige la carpeta que contiene todos tus packs.");
  } else if (classification === LIBRARY_ROOT_CLASSIFICATIONS.UNSUPPORTED_LAYOUT) {
    warnings.push("Los packs deben estar en subcarpetas directas de la biblioteca.");
  }

  return emptyPackDirectoryState({
    ...state,
    available: validRoot,
    classification,
    configured: true,
    exists: !missing,
    looksLikePackRoot,
    reason: missing
      ? "missing"
      : inaccessible
        ? "inaccessible"
        : validRoot ? null : classification,
    suggestedRootPath: candidate.suggestedRootPath,
    warnings,
  });
}

async function writePackDirectory(config, directoryPath, options = {}) {
  const normalizedPath = normalizeDirectoryPath(directoryPath);

  if (!normalizedPath) {
    throw new Error("directoryPath es obligatorio para guardar el directorio de packs.");
  }

  const packDirectoryFile = getPackDirectoryFile(config);
  const payload = {
    schemaVersion: 1,
    directoryPath: normalizedPath,
    selectedAt: options.selectedAt || options.updatedAt || new Date().toISOString(),
    updatedAt: options.updatedAt || new Date().toISOString(),
  };

  await fsp.mkdir(path.dirname(packDirectoryFile), { recursive: true });
  await fsp.writeFile(packDirectoryFile, JSON.stringify(payload, null, 2), "utf8");

  return annotateDirectoryState({
    directoryPath: payload.directoryPath,
    packDirectoryFile,
    schemaVersion: 1,
    selectedAt: payload.selectedAt,
    source: options.source || "pack-directory",
    updatedAt: payload.updatedAt,
  });
}

function normalizeStoredDirectory(parsed) {
  const directoryPath = normalizeDirectoryPath(parsed?.directoryPath);

  if (!directoryPath) {
    return null;
  }

  return {
    directoryPath,
    schemaVersion: parsed.schemaVersion || 1,
    selectedAt: typeof parsed.selectedAt === "string" ? parsed.selectedAt : null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
  };
}

async function readStoredPackDirectory(config) {
  const packDirectoryFile = getPackDirectoryFile(config);

  try {
    const raw = await fsp.readFile(packDirectoryFile, "utf8");
    const parsed = JSON.parse(raw);
    const stored = normalizeStoredDirectory(parsed);

    if (parsed && parsed.directoryPath === null) {
      return emptyPackDirectoryState({
        packDirectoryFile,
        schemaVersion: parsed.schemaVersion || 1,
        source: "pack-directory",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      });
    }

    if (!stored) {
      return emptyPackDirectoryState({
        error: "pack-directory.json no contiene directoryPath valido.",
        packDirectoryFile,
        source: "pack-directory",
        warnings: ["pack-directory.json no contiene directoryPath valido."],
      });
    }

    return annotateDirectoryState({
      ...stored,
      packDirectoryFile,
      source: "pack-directory",
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyPackDirectoryState({ packDirectoryFile });
    }

    return emptyPackDirectoryState({
      error: `No se pudo leer pack-directory.json: ${error.message}`,
      packDirectoryFile,
      source: "pack-directory",
      warnings: [`No se pudo leer pack-directory.json: ${error.message}`],
    });
  }
}

function compareLocationsByAddedAt(a, b) {
  const aTime = Date.parse(a.addedAt || "");
  const bTime = Date.parse(b.addedAt || "");

  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }

  if (Number.isFinite(aTime) && !Number.isFinite(bTime)) {
    return -1;
  }

  if (!Number.isFinite(aTime) && Number.isFinite(bTime)) {
    return 1;
  }

  return 0;
}

async function chooseLegacyLocation(locations) {
  const sorted = [...locations].sort(compareLocationsByAddedAt);

  for (const location of sorted) {
    const info = await pathInfo(location.path);

    if (info.exists && info.isDirectory) {
      return location;
    }
  }

  return sorted[0] || null;
}

async function readLegacyFallback(config, options = {}) {
  const legacy = await readLibraryLocations(config);
  const locations = legacy.locations || [];

  if (locations.length === 0) {
    return emptyPackDirectoryState({
      packDirectoryFile: getPackDirectoryFile(config),
      legacyLocationsFile: legacy.locationsFile,
      error: legacy.error,
      warnings: legacy.error ? [legacy.error] : [],
    });
  }

  if (locations.length === 1 && options.migrateLegacy !== false) {
    const location = locations[0];
    const migrated = await writePackDirectory(config, location.path, {
      selectedAt: location.addedAt || options.now,
      source: "legacy-locations",
      updatedAt: options.now,
    });

    return annotateDirectoryState({
      ...migrated,
      legacyLocationsDetected: 1,
      legacyLocationsFile: legacy.locationsFile,
      legacyMigration: "created",
      source: "legacy-locations",
      warnings: [
        ...migrated.warnings,
        "Se ha creado pack-directory.json a partir de la unica ubicacion antigua.",
      ],
    });
  }

  const chosen = await chooseLegacyLocation(locations);
  const warning = locations.length > 1
    ? "locations.json contiene varias ubicaciones antiguas. Se usa una temporalmente; elige el directorio definitivo desde la GUI."
    : "Se usa temporalmente la ubicacion antigua sin crear pack-directory.json.";

  return annotateDirectoryState({
    directoryPath: chosen?.path || null,
    legacyLocationsDetected: locations.length,
    legacyLocationsFile: legacy.locationsFile,
    legacyMigration: locations.length > 1 ? "ambiguous" : "fallback",
    packDirectoryFile: getPackDirectoryFile(config),
    selectedAt: chosen?.addedAt || null,
    source: "legacy-locations",
    updatedAt: legacy.updatedAt || null,
    warnings: [warning],
  });
}

async function readPackDirectory(config, options = {}) {
  const stored = await readStoredPackDirectory(config);

  if (stored.directoryPath || stored.error) {
    return stored;
  }

  return readLegacyFallback(config, options);
}

async function setPackDirectory(config, directoryPath, options = {}) {
  const normalizedPath = normalizeDirectoryPath(directoryPath);

  if (!normalizedPath) {
    throw new Error("El directorio de packs es obligatorio.");
  }

  const stored = await readStoredPackDirectory(config);
  const current = stored.directoryPath || stored.error
    ? stored
    : await readLegacyFallback(config, { migrateLegacy: false });
  const candidate = await classifyLibraryRootCandidate(normalizedPath, options.classifierOptions);

  if (!candidate.ok) {
    const resultMeta = {
      candidatePath: candidate.candidatePath,
      classification: candidate.classification,
      ok: false,
      packRootPath: candidate.packRootPath,
      previousLibraryRoot: current.directoryPath,
      state: current,
      suggestedRootPath: candidate.suggestedRootPath,
    };
    const failures = {
      [LIBRARY_ROOT_CLASSIFICATIONS.INSIDE_PACK]: {
        code: "inside_pack_selected",
        summary: "Esta carpeta forma parte de un pack. La biblioteca anterior se mantiene sin cambios.",
      },
      [LIBRARY_ROOT_CLASSIFICATIONS.INACCESSIBLE]: {
        code: "inaccessible_directory",
        summary: "No puedo acceder a la carpeta elegida. La biblioteca anterior se mantiene sin cambios.",
      },
      [LIBRARY_ROOT_CLASSIFICATIONS.INVALID_FILE]: {
        code: "invalid_file",
        summary: "La ruta elegida no es una carpeta. La biblioteca anterior se mantiene sin cambios.",
      },
      [LIBRARY_ROOT_CLASSIFICATIONS.MISSING]: {
        code: "missing_directory",
        summary: "No encuentro la carpeta elegida. La biblioteca anterior se mantiene sin cambios.",
      },
      [LIBRARY_ROOT_CLASSIFICATIONS.PACK_ROOT]: {
        code: "pack_root_selected",
        summary: "Has elegido la carpeta de un pack. La biblioteca anterior se mantiene sin cambios.",
      },
      [LIBRARY_ROOT_CLASSIFICATIONS.UNSUPPORTED_LAYOUT]: {
        code: "unsupported_layout",
        summary: "Los packs deben estar en subcarpetas directas. La biblioteca anterior se mantiene sin cambios.",
      },
    };

    return {
      ...resultMeta,
      ...(failures[candidate.classification] || failures[LIBRARY_ROOT_CLASSIFICATIONS.INACCESSIBLE]),
    };
  }

  const state = await writePackDirectory(config, normalizedPath, {
    selectedAt: current.selectedAt || options.selectedAt || options.updatedAt,
    updatedAt: options.updatedAt,
  });

  return {
    candidatePath: candidate.candidatePath,
    classification: candidate.classification,
    code: "ok",
    ok: true,
    previousLibraryRoot: current.directoryPath,
    state,
    suggestedRootPath: null,
    summary: "Directorio de packs actualizado.",
  };
}

async function clearPackDirectory(config, options = {}) {
  const packDirectoryFile = getPackDirectoryFile(config);
  const payload = {
    schemaVersion: 1,
    directoryPath: null,
    selectedAt: null,
    updatedAt: options.updatedAt || new Date().toISOString(),
  };

  await fsp.mkdir(path.dirname(packDirectoryFile), { recursive: true });
  await fsp.writeFile(packDirectoryFile, JSON.stringify(payload, null, 2), "utf8");

  return emptyPackDirectoryState({
    packDirectoryFile,
    source: "pack-directory",
    updatedAt: payload.updatedAt,
  });
}

module.exports = {
  LIBRARY_ROOT_CLASSIFICATIONS,
  classifyLibraryRootCandidate,
  clearPackDirectory,
  directoryLooksLikePackRoot,
  getDirectoryKey,
  getPackDirectoryFile,
  normalizeDirectoryPath,
  readPackDirectory,
  setPackDirectory,
  isValidLibraryRootClassification,
  writePackDirectory,
};
