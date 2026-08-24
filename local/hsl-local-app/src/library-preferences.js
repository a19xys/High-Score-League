const fsp = require("node:fs/promises");
const path = require("node:path");
const { derivePlayerKey } = require("./scoped-queue");
const { atomicWriteJson } = require("./secure-session-storage");
const {
  normalizePreferenceScope,
  preferenceScopeFromSession,
} = require("./preference-scope");

const VALID_LIBRARY_VIEWS = new Set(["covers", "list", "icons"]);
const VALID_LIBRARY_SORT_BY = new Set(["weeks", "title", "developer", "year"]);
const VALID_LIBRARY_SORT_DIRECTIONS = new Set(["asc", "desc"]);
const DEFAULT_LIBRARY_VIEW = "covers";
const DEFAULT_LIBRARY_SORT_BY = "weeks";
const DEFAULT_LIBRARY_SORT_DIRECTION = "asc";
const DEFAULT_SIDEBAR_WIDTH = 440;
const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 600;
const libraryWriteChains = new Map();

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

function normalizeLibrarySortBy(value) {
  return VALID_LIBRARY_SORT_BY.has(value) ? value : DEFAULT_LIBRARY_SORT_BY;
}

function normalizeLibrarySortDirection(value) {
  return VALID_LIBRARY_SORT_DIRECTIONS.has(value) ? value : DEFAULT_LIBRARY_SORT_DIRECTION;
}

function libraryPreferenceScope(identity = {}) {
  if (identity?.scope || identity?.scopeKey) return normalizePreferenceScope(identity);
  return preferenceScopeFromSession(identity);
}

function getPreferencesPath(config = {}, identity = {}) {
  if (!config.userDataDir) {
    throw new Error("config.userDataDir es obligatorio para preferencias de biblioteca.");
  }

  const preferenceScope = libraryPreferenceScope(identity);
  const { playerKey } = preferenceScope;

  if (playerKey) {
    return {
      filePath: path.join(config.userDataDir, "players", playerKey, "preferences", "library.json"),
      playerKey,
      scope: "player",
      scopeKey: preferenceScope.scopeKey,
    };
  }

  return {
    filePath: path.join(config.userDataDir, "library", "preferences.json"),
    playerKey: null,
    scope: "global",
    scopeKey: "global",
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
    librarySortBy: normalizeLibrarySortBy(raw.librarySortBy),
    librarySortDirection: normalizeLibrarySortDirection(raw.librarySortDirection),
    libraryView: normalizeLibraryView(raw.libraryView),
    playerKey: context.playerKey || null,
    schemaVersion: 1,
    scope: context.scope || "global",
    scopeKey: context.scopeKey || "global",
    sidebarWidth: clampSidebarWidth(raw.sidebarWidth),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    warnings: context.warnings || [],
  };
}

async function readLibraryPreferences(config = {}, identity = {}) {
  const context = getPreferencesPath(config, identity);

  try {
    const raw = JSON.parse(await fsp.readFile(context.filePath, "utf8"));
    return normalizePreferences(raw, context);
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizePreferences({}, context);
    }

    return normalizePreferences({}, {
      ...context,
      warnings: ["No se pudo leer library.json; se usan valores seguros."],
    });
  }
}

function serializeLibraryWrite(scopeKey, operation) {
  const previous = libraryWriteChains.get(scopeKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  libraryWriteChains.set(scopeKey, current);
  return current.finally(() => {
    if (libraryWriteChains.get(scopeKey) === current) libraryWriteChains.delete(scopeKey);
  });
}

async function writeLibraryPreferences(config = {}, identity = {}, patch = {}, options = {}) {
  const context = getPreferencesPath(config, identity);
  return serializeLibraryWrite(context.scopeKey, async () => {
    const current = await readLibraryPreferences(config, context);
    const updatedAt = options.now || new Date().toISOString();
    const next = normalizePreferences({
      librarySortBy: patch.librarySortBy === undefined ? current.librarySortBy : patch.librarySortBy,
      librarySortDirection: patch.librarySortDirection === undefined ? current.librarySortDirection : patch.librarySortDirection,
      libraryView: patch.libraryView === undefined ? current.libraryView : patch.libraryView,
      sidebarWidth: patch.sidebarWidth === undefined ? current.sidebarWidth : patch.sidebarWidth,
      updatedAt,
    }, current);
    const data = {
      librarySortBy: next.librarySortBy,
      librarySortDirection: next.librarySortDirection,
      libraryView: next.libraryView,
      schemaVersion: 1,
      sidebarWidth: next.sidebarWidth,
      updatedAt,
    };

    await (options.atomicWriteImpl || atomicWriteJson)(current.filePath, data);

    return {
      ...next,
      warnings: [],
    };
  });
}

function publicLibraryPreferences(preferences = {}) {
  const scope = normalizePreferenceScope(preferences);
  return {
    librarySortBy: normalizeLibrarySortBy(preferences.librarySortBy),
    librarySortDirection: normalizeLibrarySortDirection(preferences.librarySortDirection),
    libraryView: normalizeLibraryView(preferences.libraryView),
    playerKey: scope.playerKey,
    schemaVersion: 1,
    scope: scope.scope,
    scopeKey: scope.scopeKey,
    sidebarWidth: clampSidebarWidth(preferences.sidebarWidth),
    updatedAt: typeof preferences.updatedAt === "string" ? preferences.updatedAt : null,
    warnings: Array.isArray(preferences.warnings) ? preferences.warnings : [],
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

async function migrateLibraryFavoriteKey(config = {}, oldPackId, targetPackId, options = {}) {
  if (!config.userDataDir || typeof oldPackId !== "string" || typeof targetPackId !== "string" || oldPackId === targetPackId) {
    return { changedFiles: 0 };
  }
  const candidates = [path.join(config.userDataDir, "library", "favorites.json")];
  try {
    const playersDir = path.join(config.userDataDir, "players");
    const entries = await fsp.readdir(playersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        candidates.push(path.join(playersDir, entry.name, "preferences", "favorites.json"));
      }
    }
  } catch {}

  let changedFiles = 0;
  for (const filePath of candidates) {
    let parsed;
    try { parsed = JSON.parse(await fsp.readFile(filePath, "utf8")); }
    catch { continue; }
    if (!parsed?.favorites || typeof parsed.favorites !== "object" || Array.isArray(parsed.favorites) || parsed.favorites[oldPackId] !== true) continue;
    const favorites = { ...parsed.favorites, [targetPackId]: true };
    delete favorites[oldPackId];
    await (options.atomicWriteImpl || atomicWriteJson)(filePath, {
      ...parsed,
      favorites,
      schemaVersion: 1,
      updatedAt: options.now || new Date().toISOString(),
    });
    changedFiles += 1;
  }
  return { changedFiles };
}

module.exports = {
  DEFAULT_LIBRARY_VIEW,
  DEFAULT_LIBRARY_SORT_BY,
  DEFAULT_LIBRARY_SORT_DIRECTION,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  VALID_LIBRARY_SORT_BY,
  VALID_LIBRARY_SORT_DIRECTIONS,
  VALID_LIBRARY_VIEWS,
  clampSidebarWidth,
  getFavoritesPath,
  getPreferencesPath,
  normalizeLibrarySortBy,
  normalizeLibrarySortDirection,
  normalizeLibraryView,
  migrateLibraryFavoriteKey,
  publicLibraryPreferences,
  readLibraryFavorites,
  readLibraryPreferences,
  toggleLibraryFavorite,
  writeLibraryFavorites,
  writeLibraryPreferences,
};
