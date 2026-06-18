const fs = require("node:fs");
const path = require("node:path");

function getDefaultPackPath(appDir) {
  return path.join(path.resolve(appDir, ".."), "pack.json");
}

function resolvePackMamePaths(pack, packDir) {
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
  const errors = [];

  if (!pack || typeof pack !== "object") {
    return ["pack.json debe contener un objeto JSON"];
  }

  for (const field of ["packVersion", "gameId", "rom", "weekId", "webBaseUrl", "mame"]) {
    if (pack[field] === undefined || pack[field] === null || pack[field] === "") {
      errors.push(`pack.json debe incluir ${field}`);
    }
  }

  if (pack.mame && typeof pack.mame !== "object") {
    errors.push("pack.json mame debe ser un objeto");
  } else if (pack.mame) {
    if (!pack.mame.relativeExecutablePath && !pack.mame.executablePath) {
      errors.push("pack.json mame debe incluir relativeExecutablePath");
    }

    if (!pack.mame.workingDir) {
      errors.push("pack.json mame debe incluir workingDir");
    }
  }

  return errors;
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
  const errors = validatePack(pack);

  return {
    pack: {
      ...pack,
      packPath,
      packRoot: path.dirname(packPath),
    },
    packPath,
    errors,
    loaded: true,
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
  resolvePackMamePaths,
  validatePack,
};
