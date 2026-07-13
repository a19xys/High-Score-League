const fsp = require("node:fs/promises");
const path = require("node:path");
const { readLibraryLocations } = require("./library-locations");

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

async function annotateDirectoryState(state) {
  const warnings = [...(state.warnings || [])];

  if (!state.directoryPath) {
    return emptyPackDirectoryState({
      ...state,
      warnings,
    });
  }

  const info = await pathInfo(state.directoryPath);
  const looksLikePackRoot = info.exists && info.isDirectory
    ? await directoryLooksLikePackRoot(state.directoryPath)
    : false;

  const missing = !info.exists && ["ENOENT", "ENOTDIR"].includes(info.errorCode);
  const inaccessible = (!info.exists && !missing) || (info.exists && !info.isDirectory);

  if (missing) {
    warnings.push("No se encuentra el directorio de packs. Recupera la carpeta o cambia la ubicación de la biblioteca.");
  } else if (inaccessible) {
    warnings.push("No puedo acceder al directorio de packs. Comprueba que la unidad esté conectada o cambia la ubicación de la biblioteca.");
  } else if (looksLikePackRoot) {
    warnings.push("Parece que has elegido una carpeta de pack. Elige la carpeta que contiene todos tus packs.");
  }

  return emptyPackDirectoryState({
    ...state,
    available: info.exists && info.isDirectory,
    configured: true,
    exists: info.exists,
    looksLikePackRoot,
    reason: missing ? "missing" : inaccessible ? "inaccessible" : null,
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

  const info = await pathInfo(normalizedPath);

  if (!info.exists || !info.isDirectory) {
    return {
      code: "missing_directory",
      ok: false,
      state: await annotateDirectoryState({
        directoryPath: normalizedPath,
        packDirectoryFile: getPackDirectoryFile(config),
        source: "selected",
      }),
      summary: "No encuentro el directorio de packs.",
    };
  }

  if (await directoryLooksLikePackRoot(normalizedPath)) {
    return {
      code: "pack_root_selected",
      ok: false,
      state: await annotateDirectoryState({
        directoryPath: normalizedPath,
        packDirectoryFile: getPackDirectoryFile(config),
        source: "selected",
      }),
      summary: "Parece que has elegido una carpeta de pack. Elige la carpeta que contiene todos tus packs.",
    };
  }

  const current = await readStoredPackDirectory(config);
  const state = await writePackDirectory(config, normalizedPath, {
    selectedAt: current.selectedAt || options.selectedAt || options.updatedAt,
    updatedAt: options.updatedAt,
  });

  return {
    code: "ok",
    ok: true,
    state,
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
  clearPackDirectory,
  directoryLooksLikePackRoot,
  getDirectoryKey,
  getPackDirectoryFile,
  normalizeDirectoryPath,
  readPackDirectory,
  setPackDirectory,
  writePackDirectory,
};
