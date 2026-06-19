const fsp = require("node:fs/promises");
const path = require("node:path");

function getRecentPacksFile(config) {
  if (!config?.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para recent packs.");
  }

  return path.join(config.userDataDir, "packs", "recent.json");
}

function emptyRecentPackState(overrides = {}) {
  return {
    error: null,
    lastOpenedPackDir: null,
    recentPacksFile: overrides.recentPacksFile || null,
    updatedAt: null,
    ...overrides,
  };
}

async function readRecentPackState(config) {
  const recentPacksFile = getRecentPacksFile(config);

  try {
    const raw = await fsp.readFile(recentPacksFile, "utf8");
    const parsed = JSON.parse(raw);
    const lastOpenedPackDir = typeof parsed.lastOpenedPackDir === "string" && parsed.lastOpenedPackDir.trim() !== ""
      ? parsed.lastOpenedPackDir
      : null;

    return emptyRecentPackState({
      lastOpenedPackDir,
      recentPacksFile,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyRecentPackState({ recentPacksFile });
    }

    return emptyRecentPackState({
      error: `No se pudo leer recent.json: ${error.message}`,
      recentPacksFile,
    });
  }
}

async function writeLastOpenedPack(config, packDir, options = {}) {
  if (typeof packDir !== "string" || packDir.trim() === "") {
    throw new Error("packDir es obligatorio para recordar el último pack.");
  }

  const recentPacksFile = getRecentPacksFile(config);
  const updatedAt = options.updatedAt || new Date().toISOString();
  const payload = {
    lastOpenedPackDir: packDir,
    updatedAt,
  };

  await fsp.mkdir(path.dirname(recentPacksFile), { recursive: true });
  await fsp.writeFile(recentPacksFile, JSON.stringify(payload, null, 2), "utf8");

  return {
    ...payload,
    recentPacksFile,
  };
}

async function clearLastOpenedPack(config, options = {}) {
  const recentPacksFile = getRecentPacksFile(config);
  const payload = {
    lastOpenedPackDir: null,
    updatedAt: options.updatedAt || new Date().toISOString(),
  };

  await fsp.mkdir(path.dirname(recentPacksFile), { recursive: true });
  await fsp.writeFile(recentPacksFile, JSON.stringify(payload, null, 2), "utf8");

  return {
    ...payload,
    recentPacksFile,
  };
}

module.exports = {
  clearLastOpenedPack,
  getRecentPacksFile,
  readRecentPackState,
  writeLastOpenedPack,
};
