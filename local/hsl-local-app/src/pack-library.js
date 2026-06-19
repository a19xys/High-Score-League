const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { readLibraryLocations } = require("./library-locations");
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

function buildLibraryPackItem(location, packDir, packResult) {
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
    id: hashId(`${location.id}|${packDir}`, "pack"),
    locationId: location.id,
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

async function scanLocation(location) {
  const exists = await pathExistsAsDirectory(location.path);
  const status = {
    ...location,
    error: null,
    exists,
    packCount: 0,
    status: exists ? "ok" : "missing",
    warnings: exists ? [] : ["Esta ubicacion no esta disponible."],
  };

  if (!exists) {
    return {
      location: status,
      packs: [],
    };
  }

  let entries;

  try {
    entries = await fsp.readdir(location.path, { withFileTypes: true });
  } catch (error) {
    return {
      location: {
        ...status,
        error: error.message,
        status: "warning",
        warnings: [`No se pudo escanear esta ubicacion: ${error.message}`],
      },
      packs: [],
    };
  }

  const packs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packDir = path.join(location.path, entry.name);
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

      packs.push(buildLibraryPackItem(location, packDir, result));
    } catch (error) {
      packs.push({
        cover: null,
        errors: [error.message],
        gameId: null,
        icon: null,
        id: hashId(`${location.id}|${packDir}`, "pack"),
        locationId: location.id,
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
    location: {
      ...status,
      packCount: packs.length,
      status: packs.some((pack) => pack.status === "error") ? "warning" : "ok",
    },
    packs,
  };
}

async function scanPackLibrary(config) {
  const state = await readLibraryLocations(config);
  const scans = await Promise.all(state.locations.map(scanLocation));
  const locations = scans.map((scan) => scan.location);
  const packs = scans.flatMap((scan) => scan.packs);

  return {
    error: state.error,
    locations,
    locationsFile: state.locationsFile,
    packs,
    totals: {
      locations: locations.length,
      missingLocations: locations.filter((location) => location.status === "missing").length,
      packs: packs.length,
      packsWithErrors: packs.filter((pack) => pack.status === "error").length,
    },
    updatedAt: state.updatedAt,
  };
}

module.exports = {
  buildLibraryPackItem,
  scanLocation,
  scanPackLibrary,
};
