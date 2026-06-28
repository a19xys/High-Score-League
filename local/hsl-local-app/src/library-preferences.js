const fsp = require("node:fs/promises");
const path = require("node:path");
const { derivePlayerKey } = require("./scoped-queue");

const VALID_LIBRARY_VIEWS = new Set(["covers", "list", "icons"]);
const DEFAULT_LIBRARY_VIEW = "covers";
const DEFAULT_SIDEBAR_WIDTH = 440;
const MIN_SIDEBAR_WIDTH = 360;
const MAX_SIDEBAR_WIDTH = 600;

function clampSidebarWidth(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(numeric)));
}

function normalizeLibraryView(value) {
  return VALID_LIBRARY_VIEWS.has(value) ? value : DEFAULT_LIBRARY_VIEW;
}

function getPreferencesPath(config = {}, session = {}) {
  if (!config.userDataDir) {
    throw new Error("config.userDataDir es obligatorio para preferencias de biblioteca.");
  }

  const playerKey = derivePlayerKey(session);

  if (playerKey) {
    return {
      filePath: path.join(config.userDataDir, "players", playerKey, "preferences", "library.json"),
      playerKey,
      scope: "player",
    };
  }

  return {
    filePath: path.join(config.userDataDir, "library", "preferences.json"),
    playerKey: null,
    scope: "global",
  };
}

function getFavoritesPath(config = {}, session = {}) {
  if (!config.userDataDir) {
    throw new Error("config.userDataDir es obligatorio para favoritos de biblioteca.");
  }

  const playerKey = derivePlayerKey(session);

  if (playerKey) {
    return {
      filePath: path.join(config.userDataDir, "players", playerKey, "preferences", "favorites.json"),
      playerKey,
      scope: "player",
    };
  }

  return {
    filePath: path.join(config.userDataDir, "library", "favorites.json"),
    playerKey: null,
    scope: "global",
  };
}

function normalizePreferences(raw = {}, context = {}) {
  return {
    filePath: context.filePath || null,
    libraryView: normalizeLibraryView(raw.libraryView),
    playerKey: context.playerKey || null,
    schemaVersion: 1,
    scope: context.scope || "global",
    sidebarWidth: clampSidebarWidth(raw.sidebarWidth),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    warnings: context.warnings || [],
  };
}

async function readLibraryPreferences(config = {}, session = {}) {
  const context = getPreferencesPath(config, session);

  try {
    const raw = JSON.parse(await fsp.readFile(context.filePath, "utf8"));
    return normalizePreferences(raw, context);
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizePreferences({}, context);
    }

    return normalizePreferences({}, {
      ...context,
      warnings: [`No se pudo leer library.json: ${error.message}`],
    });
  }
}

async function writeLibraryPreferences(config = {}, session = {}, patch = {}, options = {}) {
  const current = await readLibraryPreferences(config, session);
  const updatedAt = options.now || new Date().toISOString();
  const next = normalizePreferences({
    libraryView: patch.libraryView === undefined ? current.libraryView : patch.libraryView,
    sidebarWidth: patch.sidebarWidth === undefined ? current.sidebarWidth : patch.sidebarWidth,
    updatedAt,
  }, current);
  const data = {
    libraryView: next.libraryView,
    schemaVersion: 1,
    sidebarWidth: next.sidebarWidth,
    updatedAt,
  };

  await fsp.mkdir(path.dirname(current.filePath), { recursive: true });
  await fsp.writeFile(current.filePath, JSON.stringify(data, null, 2), "utf8");

  return {
    ...next,
    warnings: [],
  };
}

function normalizeFavorites(raw = {}, context = {}, warnings = []) {
  const source = raw && typeof raw.favorites === "object" && !Array.isArray(raw.favorites)
    ? raw.favorites
    : {};
  const favorites = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof key === "string" && key.trim() && value === true) {
      favorites[key] = true;
    }
  }

  return {
    favorites,
    filePath: context.filePath || null,
    playerKey: context.playerKey || null,
    schemaVersion: 1,
    scope: context.scope || "global",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    warnings,
  };
}

async function readLibraryFavorites(config = {}, session = {}) {
  const context = getFavoritesPath(config, session);

  try {
    const raw = JSON.parse(await fsp.readFile(context.filePath, "utf8"));
    return normalizeFavorites(raw, context);
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeFavorites({}, context);
    }

    return normalizeFavorites({}, context, [`No se pudo leer favorites.json: ${error.message}`]);
  }
}

async function writeLibraryFavorites(config = {}, session = {}, favorites = {}, options = {}) {
  const context = getFavoritesPath(config, session);
  const data = {
    favorites,
    schemaVersion: 1,
    updatedAt: options.now || new Date().toISOString(),
  };

  await fsp.mkdir(path.dirname(context.filePath), { recursive: true });
  await fsp.writeFile(context.filePath, JSON.stringify(data, null, 2), "utf8");

  return normalizeFavorites(data, context);
}

async function toggleLibraryFavorite(config = {}, packKey, options = {}) {
  const safeKey = typeof packKey === "string" ? packKey.trim() : "";
  const session = options.session || {};
  const current = await readLibraryFavorites(config, session);

  if (!session?.hasSession) {
    return {
      ...current,
      disabled: true,
      warnings: [
        ...(current.warnings || []),
        "Inicia sesion para marcar favoritos.",
      ],
    };
  }

  if (!safeKey) {
    return current;
  }

  const favorites = {
    ...current.favorites,
  };

  if (favorites[safeKey]) {
    delete favorites[safeKey];
  } else {
    favorites[safeKey] = true;
  }

  return writeLibraryFavorites(config, session, favorites, options);
}

module.exports = {
  DEFAULT_LIBRARY_VIEW,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  VALID_LIBRARY_VIEWS,
  clampSidebarWidth,
  getFavoritesPath,
  getPreferencesPath,
  normalizeLibraryView,
  readLibraryFavorites,
  readLibraryPreferences,
  toggleLibraryFavorite,
  writeLibraryFavorites,
  writeLibraryPreferences,
};
