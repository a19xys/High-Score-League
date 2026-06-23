const fs = require("node:fs");
const path = require("node:path");
const { normalizePackContract } = require("./pack-contract");
const { loadPackMetadata } = require("./pack-metadata");

function getDefaultPackPath(appDir) {
  return path.join(path.resolve(appDir, ".."), "pack.json");
}

/**
 * @deprecated packVersion 1 puede declarar MAME dentro del pack. Mantener solo
 * hasta LOCAL-SHARED-MAME-RUNTIME-1 y la migracion completa a packVersion 2.
 */
function resolvePackMamePaths(pack, packDir) {
  if (pack?.packVersion === 2 || pack?.contract?.version === 2) {
    return {
      executablePath: null,
      workingDir: null,
      pluginName: pack?.capture?.pluginName || pack?.contract?.capture?.pluginName || "hsl-score",
      requiresSharedMameRuntime: true,
    };
  }

  const mame = pack?.mame || {};

  return {
    executablePath: resolvePackRelativePath(mame.relativeExecutablePath || mame.executablePath, packDir),
    workingDir: resolvePackRelativePath(mame.workingDir, packDir),
    pluginName: mame.pluginName,
  };
}

function resolvePackRelativePath(value, packDir) {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(packDir, value);
}

function validatePack(pack) {
  return normalizePackContract(pack).errors;
}

function loadPack(packPath) {
  if (!fs.existsSync(packPath)) {
    return {
      pack: null,
      packPath,
      errors: [],
      loaded: false,
    };
  }

  const raw = fs.readFileSync(packPath, "utf8");
  const pack = JSON.parse(raw);
  const packRoot = path.dirname(packPath);
  const contract = normalizePackContract(pack, {
    packPath,
    packRoot,
  });
  const errors = contract.errors;
  const metadata = loadPackMetadata(packRoot);
  const normalized = contract.normalized || {};

  return {
    pack: {
      ...pack,
      ...normalized,
      contract: normalized.contract || null,
      contractStatus: normalized.contractStatus || null,
      deprecated: normalized.deprecated === true,
      deprecationReason: normalized.deprecationReason || null,
      errors,
      packPath,
      packRoot,
      replacement: normalized.replacement || null,
      metadata: metadata.metadata,
      metadataLoaded: metadata.loaded,
      metadataPath: metadata.metadataPath,
      metadataWarnings: metadata.warnings,
      warnings: [
        ...contract.warnings,
        ...metadata.warnings,
      ],
    },
    packPath,
    errors,
    loaded: true,
    metadata,
    warnings: [
      ...contract.warnings,
      ...metadata.warnings,
    ],
  };
}

function loadPackFromDir(packDir) {
  return loadPack(path.join(packDir, "pack.json"));
}

function loadDefaultPack(appDir, configuredPackPath) {
  const packPath = configuredPackPath
    ? path.resolve(appDir, configuredPackPath)
    : getDefaultPackPath(appDir);

  return loadPack(packPath);
}

module.exports = {
  getDefaultPackPath,
  loadDefaultPack,
  loadPack,
  loadPackFromDir,
  normalizePackContract,
  resolvePackMamePaths,
  validatePack,
};
