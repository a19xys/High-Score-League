const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  LIBRARY_ROOT_CLASSIFICATIONS,
  isValidLibraryRootClassification,
  readPackDirectory,
} = require("./pack-directory");
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

function humanizeIdentifier(value) {
  const cleaned = String(value || "")
    .replace(/\.(json|zip)$/i, "")
    .replace(/(?:^|[-_])(?:dev|development|pack|local|deprecated|legacy)(?=$|[-_])/gi, "-")
    .replace(/(?:^|[-_])week[-_]?\d+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.replace(/\b[a-z0-9]/gi, (match) => match.toUpperCase());
}

function weekLabel(pack) {
  if (pack?.weekNumber) {
    return `Semana ${pack.weekNumber}`;
  }

  const match = String(pack?.weekId || "").match(/^week[-_ ]?(\d+)$/i);

  return match ? `Semana ${match[1]}` : null;
}

function getPackTitle(pack) {
  return pack?.metadata?.title ||
    humanizeIdentifier(pack?.title) ||
    humanizeIdentifier(pack?.gameId) ||
    humanizeIdentifier(pack?.packId) ||
    humanizeIdentifier(pack?.rom) ||
    "Pack local";
}

function getPackSubtitle(pack) {
  const season = pack?.seasonName || null;
  const week = weekLabel(pack);

  return pack?.metadata?.subtitle || [season, week].filter(Boolean).join(" · ") || week || season || null;
}

function getFavoriteKey(pack, packDir) {
  return pack?.packId ||
    [pack?.gameId, pack?.rom, pack?.weekId].filter(Boolean).join("|") ||
    packDir;
}

function getMissingRomMessage(pack) {
  const isPackV2 = pack?.packVersion === 2 || pack?.contract?.version === 2;
  const rom = pack?.rom;
  const romDir = pack?.contract?.mame?.romDir;

  if (!isPackV2 || !rom || !romDir) {
    return null;
  }

  const romFile = path.join(romDir, `${rom}.zip`);

  if (fs.existsSync(romFile)) {
    return null;
  }

  const romPath = pack?.contract?.mame?.romPath || "roms";
  const relativeRom = `${String(romPath).replaceAll("\\", "/").replace(/\/+$/, "")}/${rom}.zip`;

  return `Falta la ROM necesaria: ${relativeRom}.`;
}

function buildLibraryPackItem(directory, packDir, packResult) {
  const pack = packResult.pack || {};
  const missingRomMessage = getMissingRomMessage(pack);
  const errors = [
    ...(packResult.errors || []),
    ...(missingRomMessage ? [missingRomMessage] : []),
  ];
  const warnings = pack.warnings || packResult.warnings || pack.metadataWarnings || [];
  const status = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";
  const assets = pack.metadata?.assets || {};

  return {
    contractStatus: pack.contractStatus || null,
    cover: assetForLibrary(assets.cover),
    developer: pack.metadata?.developer || null,
    deprecated: pack.deprecated === true,
    deprecationReason: pack.deprecationReason || null,
    errors,
    gameId: pack.gameId || null,
    genre: pack.metadata?.genre || [],
    hero: assetForLibrary(assets.hero),
    icon: assetForLibrary(assets.icon),
    id: hashId(`${directory.id}|${packDir}`, "pack"),
    instanceKey: hashId(path.resolve(packDir).toLowerCase(), "instance"),
    favoriteKey: getFavoriteKey(pack, packDir),
    locationId: directory.id,
    logo: assetForLibrary(assets.logo),
    packDir,
    packId: pack.packId || null,
    packPath: pack.packPath || path.join(packDir, "pack.json"),
    packVersion: pack.packVersion || null,
    publisher: pack.metadata?.publisher || null,
    replacement: pack.replacement || null,
    rom: pack.rom || null,
    seasonId: pack.seasonId || null,
    seasonName: pack.seasonName || null,
    seasonSlug: pack.seasonSlug || null,
    shortDescription: pack.metadata?.shortDescription || null,
    status,
    subtitle: getPackSubtitle(pack),
    title: getPackTitle(pack),
    warnings,
    weekId: pack.weekId || null,
    weekNumber: pack.weekNumber || null,
    year: pack.metadata?.year || null,
  };
}

function groupDuplicatePackIds(packs) {
  const byPackId = new Map();
  const duplicateKeys = new Set();

  for (const pack of packs) {
    if (!pack.packId) {
      continue;
    }

    const key = String(pack.packId).trim().toLowerCase();

    if (!key) {
      continue;
    }

    if (!byPackId.has(key)) {
      byPackId.set(key, []);
    }

    byPackId.get(key).push(pack);
  }

  for (const [key, duplicates] of byPackId.entries()) {
    if (duplicates.length < 2) {
      continue;
    }

    duplicateKeys.add(key);
  }

  if (duplicateKeys.size === 0) {
    return packs;
  }

  const message = "Hay otro pack con el mismo packId. Cambia el packId o elimina el duplicado.";

  return packs.map((pack) => {
    const key = pack.packId ? String(pack.packId).trim().toLowerCase() : "";

    if (!duplicateKeys.has(key)) {
      return pack;
    }

    const duplicates = byPackId.get(key);
    const paths = duplicates.map((item) => item.packDir).filter(Boolean);

    return {
      ...pack,
      duplicateGroup: false,
      duplicatePackId: true,
      duplicatePackIdCount: duplicates.length,
      duplicatePacks: duplicates.map((item) => ({
        errors: item.errors || [],
        id: item.id,
        instanceKey: item.instanceKey,
        packDir: item.packDir,
        status: item.status,
        title: item.title,
      })),
      duplicatePaths: paths,
      errors: [...new Set([message, ...(pack.errors || [])])],
      favoriteDisabled: true,
      favoriteKey: null,
      status: "error",
      warnings: [],
    };
  });
}

async function scanDirectory(directoryState, options = {}) {
  const directoryPath = directoryState.directoryPath;
  const classification = directoryState.classification || (
    directoryState.looksLikePackRoot
      ? LIBRARY_ROOT_CLASSIFICATIONS.PACK_ROOT
      : directoryState.available
        ? LIBRARY_ROOT_CLASSIFICATIONS.VALID_EMPTY_ROOT
        : null
  );
  const validRoot = isValidLibraryRootClassification(classification);
  const directory = {
    available: Boolean(directoryState.available),
    classification,
    configured: Boolean(directoryPath),
    error: directoryState.error,
    exists: directoryState.exists,
    id: "pack-directory",
    looksLikePackRoot: directoryState.looksLikePackRoot,
    packCount: 0,
    path: directoryPath,
    reason: directoryState.reason || null,
    status: !directoryPath
      ? "unconfigured"
      : classification === LIBRARY_ROOT_CLASSIFICATIONS.MISSING ||
          classification === LIBRARY_ROOT_CLASSIFICATIONS.INACCESSIBLE ||
          classification === LIBRARY_ROOT_CLASSIFICATIONS.INVALID_FILE
        ? directoryState.reason || "inaccessible"
        : !validRoot
          ? classification || "inaccessible"
          : "ok",
    warnings: directoryState.warnings || [],
  };

  if (!directoryPath || !validRoot) {
    return {
      directory,
      packs: [],
    };
  }

  const status = {
    ...directory,
    available: true,
    error: null,
    exists: true,
    packCount: 0,
    reason: null,
    status: "ok",
    warnings: directory.warnings,
  };

  let entries;

  try {
    entries = await (options.readdirImpl || fsp.readdir)(directoryPath, { withFileTypes: true });
  } catch (error) {
    const reason = ["ENOENT", "ENOTDIR"].includes(error?.code) ? "missing" : "inaccessible";
    const warning = reason === "missing"
      ? "No se encuentra el directorio de packs. Recupera la carpeta o cambia la ubicación de la biblioteca."
      : "No puedo acceder al directorio de packs. Comprueba que la unidad esté conectada o cambia la ubicación de la biblioteca.";

    return {
      directory: {
        ...status,
        available: false,
        error: error.message,
        reason,
        status: reason,
        warnings: [warning],
      },
      packs: [],
    };
  }

  const packs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith(".hsl-import-")) {
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
        instanceKey: hashId(path.resolve(packDir).toLowerCase(), "instance"),
        favoriteKey: packDir,
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

  const markedPacks = groupDuplicatePackIds(packs);

  return {
    directory: {
      ...status,
      packCount: markedPacks.length,
      status: markedPacks.some((pack) => pack.status === "error") ? "warning" : "ok",
    },
    packs: markedPacks,
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
  const status = !directory.configured
    ? "unconfigured"
    : !directory.available
      ? ["missing", "inaccessible"].includes(directory.reason)
        ? directory.reason
        : "error"
      : packs.length === 0
          ? "available-empty"
          : "available-populated";

  return {
    error: state.error,
    directory,
    locations: directory.path ? [directory] : [],
    locationsFile: state.legacyLocationsFile,
    packDirectoryFile: state.packDirectoryFile,
    packDirectoryPath: state.directoryPath,
    packs,
    source: state.source,
    status,
    totals: {
      directoryConfigured: directory.path ? 1 : 0,
      directoryMissing: directory.reason === "missing" ? 1 : 0,
      directoryUnavailable: directory.configured && !directory.available ? 1 : 0,
      legacyLocations: state.legacyLocationsDetected || 0,
      locations: directory.path ? 1 : 0,
      missingLocations: directory.reason === "missing" ? 1 : 0,
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
  getFavoriteKey,
  getPackSubtitle,
  getPackTitle,
  humanizeIdentifier,
  groupDuplicatePackIds,
  scanDirectory,
  scanPackLibrary,
  weekLabel,
};
