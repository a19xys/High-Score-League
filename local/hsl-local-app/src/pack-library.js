const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { readPackDirectory } = require("./pack-directory");
const { loadPackFromDir } = require("./pack");

function hashId(value, prefix) {
  return `${prefix}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 14)}`;
}

function assetForLibrary(asset) {
  if (!asset) {
    return null;
  }

  return {
    extension: asset.extension,
    relativePath: asset.relativePath,
    url: asset.url,
  };
}

function getPackTitle(pack) {
  return pack?.metadata?.title || pack?.packId || pack?.gameId || pack?.rom || "Pack sin titulo";
}

function getPackSubtitle(pack) {
  return pack?.metadata?.subtitle || pack?.weekId || null;
}

function buildLibraryPackItem(directory, packDir, packResult) {
  const pack = packResult.pack || {};
  const errors = packResult.errors || [];
  const warnings = pack.metadataWarnings || [];
  const status = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";
  const assets = pack.metadata?.assets || {};

  return {
    cover: assetForLibrary(assets.cover),
    errors,
    gameId: pack.gameId || null,
    icon: assetForLibrary(assets.icon),
    id: hashId(`${directory.id}|${packDir}`, "pack"),
    locationId: directory.id,
    logo: assetForLibrary(assets.logo),
    packDir,
    packId: pack.packId || null,
    packPath: pack.packPath || path.join(packDir, "pack.json"),
    rom: pack.rom || null,
    status,
    subtitle: getPackSubtitle(pack),
    title: getPackTitle(pack),
    warnings,
    weekId: pack.weekId || null,
  };
}

async function pathExistsAsDirectory(targetPath) {
  try {
    const stat = await fsp.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function scanDirectory(directoryState) {
  const directoryPath = directoryState.directoryPath;
  const directory = {
    error: directoryState.error,
    exists: directoryState.exists,
    id: "pack-directory",
    looksLikePackRoot: directoryState.looksLikePackRoot,
    packCount: 0,
    path: directoryPath,
    status: !directoryPath
      ? "unconfigured"
      : !directoryState.exists
        ? "missing"
        : directoryState.looksLikePackRoot
          ? "pack-root"
          : "ok",
    warnings: directoryState.warnings || [],
  };

  if (!directoryPath || !directoryState.exists || directoryState.looksLikePackRoot) {
    return {
      directory,
      packs: [],
    };
  }

  const exists = await pathExistsAsDirectory(directoryPath);
  const status = {
    ...directory,
    error: null,
    exists,
    packCount: 0,
    status: exists ? "ok" : "missing",
    warnings: exists ? directory.warnings : ["No encuentro el directorio de packs. Puedes cambiarlo o volver a crearlo."],
  };

  if (!exists) {
    return {
      directory: status,
      packs: [],
    };
  }

  let entries;

  try {
    entries = await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    return {
      directory: {
        ...status,
        error: error.message,
        status: "warning",
        warnings: [`No se pudo escanear el directorio de packs: ${error.message}`],
      },
      packs: [],
    };
  }

  const packs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packDir = path.join(directoryPath, entry.name);
    const packPath = path.join(packDir, "pack.json");

    try {
      await fsp.access(packPath);
    } catch {
      continue;
    }

    try {
      const result = loadPackFromDir(packDir);

      if (!result.loaded) {
        continue;
      }

      packs.push(buildLibraryPackItem(directory, packDir, result));
    } catch (error) {
      packs.push({
        cover: null,
        errors: [error.message],
        gameId: null,
        icon: null,
        id: hashId(`${directory.id}|${packDir}`, "pack"),
        locationId: directory.id,
        logo: null,
        packDir,
        packId: null,
        packPath,
        rom: null,
        status: "error",
        subtitle: null,
        title: entry.name,
        warnings: [],
        weekId: null,
      });
    }
  }

  return {
    directory: {
      ...status,
      packCount: packs.length,
      status: packs.some((pack) => pack.status === "error") ? "warning" : "ok",
    },
    packs,
  };
}

async function scanPackLibrary(config) {
  const state = await readPackDirectory(config);
  const scan = await scanDirectory(state);
  const directory = scan.directory;
  const packs = scan.packs;
  const warnings = [
    state.error,
    ...(directory?.warnings || []),
  ].filter(Boolean);

  return {
    error: state.error,
    directory,
    locations: directory.path ? [directory] : [],
    locationsFile: state.legacyLocationsFile,
    packDirectoryFile: state.packDirectoryFile,
    packDirectoryPath: state.directoryPath,
    packs,
    source: state.source,
    totals: {
      directoryConfigured: directory.path ? 1 : 0,
      directoryMissing: directory.status === "missing" ? 1 : 0,
      legacyLocations: state.legacyLocationsDetected || 0,
      locations: directory.path ? 1 : 0,
      missingLocations: directory.status === "missing" ? 1 : 0,
      packs: packs.length,
      packsWithErrors: packs.filter((pack) => pack.status === "error").length,
    },
    updatedAt: state.updatedAt,
    warnings,
    legacy: {
      locationsDetected: state.legacyLocationsDetected || 0,
      locationsFile: state.legacyLocationsFile,
      migration: state.legacyMigration || "none",
    },
  };
}

module.exports = {
  buildLibraryPackItem,
  scanDirectory,
  scanPackLibrary,
};
