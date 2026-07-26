const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const THEME_SCHEMA_VERSION = 1;
const VALID_THEMES = new Set(["light", "dark"]);
const VALID_MODES = new Set(["system", "manual"]);
const THEME_PERSISTENCE_ERROR_CODES = Object.freeze({
  directoryConflict: "THEME_PREFERENCE_DIRECTORY_CONFLICT",
  failed: "THEME_PERSISTENCE_FAILED",
  fileConflict: "THEME_PREFERENCE_FILE_CONFLICT",
  invalidValue: "THEME_INVALID_VALUE",
});

function normalizeTheme(value) {
  return VALID_THEMES.has(value) ? value : null;
}

function normalizeSystemTheme(value) {
  return normalizeTheme(value);
}

function themeBackgroundColor(theme) {
  return theme === "light" ? "#eef4fb" : "#0f172a";
}

function getThemePreferenceDirectory(userDataDir) {
  if (!userDataDir) throw new Error("userDataDir es obligatorio para el tema.");
  return path.join(userDataDir, "hsl", "preferences");
}

function getThemePreferencePath(userDataDir) {
  return path.join(getThemePreferenceDirectory(userDataDir), "theme.json");
}

function getLegacyThemePreferencePath(userDataDir) {
  if (!userDataDir) throw new Error("userDataDir es obligatorio para el tema.");
  return path.join(userDataDir, "preferences", "theme.json");
}

function createThemePersistenceError(code, cause) {
  const error = new Error("No se pudo guardar la preferencia de tema.", { cause });
  error.name = "ThemePersistenceError";
  error.code = code;
  return error;
}

function themePersistenceErrorCode(error) {
  if (Object.values(THEME_PERSISTENCE_ERROR_CODES).includes(error?.code)) return error.code;
  if (error instanceof TypeError) return THEME_PERSISTENCE_ERROR_CODES.invalidValue;
  if (["EEXIST", "ENOTDIR"].includes(error?.code)) return THEME_PERSISTENCE_ERROR_CODES.directoryConflict;
  if (error?.code === "EISDIR") return THEME_PERSISTENCE_ERROR_CODES.fileConflict;
  return THEME_PERSISTENCE_ERROR_CODES.failed;
}

function normalizeThemePersistenceError(error) {
  if (error?.name === "ThemePersistenceError") return error;
  return createThemePersistenceError(themePersistenceErrorCode(error), error);
}

function parseThemePreference(contents) {
  if (contents === undefined || contents === null || contents === "") {
    return { kind: "missing", value: null };
  }

  const text = String(contents).trim();
  if (VALID_THEMES.has(text)) {
    return { kind: "legacy", value: text };
  }

  try {
    const parsed = JSON.parse(text);
    if (VALID_THEMES.has(parsed)) return { kind: "legacy", value: parsed };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "invalid", value: null };
    }

    const legacyTheme = normalizeTheme(parsed.theme);
    if (!VALID_MODES.has(parsed.mode) && legacyTheme) {
      return { kind: "legacy", value: legacyTheme };
    }

    const mode = VALID_MODES.has(parsed.mode) ? parsed.mode : null;
    const manualTheme = normalizeTheme(parsed.manualTheme);
    const lastSystemTheme = normalizeSystemTheme(parsed.lastSystemTheme);
    if (!mode || (mode === "manual" && !manualTheme)) {
      return { kind: "invalid", value: null };
    }

    return {
      kind: "canonical",
      value: {
        effectiveTheme: normalizeTheme(parsed.effectiveTheme),
        lastSystemTheme,
        manualTheme: mode === "manual" ? manualTheme : null,
        mode,
        schemaVersion: THEME_SCHEMA_VERSION,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      },
    };
  } catch {
    return { kind: "invalid", value: null };
  }
}

function canonicalThemeState({
  effectiveTheme,
  lastSystemTheme = null,
  manualTheme = null,
  mode,
  now,
  source,
  warnings = [],
}) {
  return {
    effectiveTheme: normalizeTheme(effectiveTheme) || "dark",
    lastSystemTheme: normalizeSystemTheme(lastSystemTheme),
    manualTheme: mode === "manual" ? normalizeTheme(manualTheme) : null,
    mode: VALID_MODES.has(mode) ? mode : "system",
    schemaVersion: THEME_SCHEMA_VERSION,
    source,
    updatedAt: now,
    warnings: [...warnings],
  };
}

function resolveThemeForStartup(contents, systemTheme, options = {}) {
  const observedSystemTheme = normalizeSystemTheme(systemTheme);
  const parsed = parseThemePreference(contents);
  const now = options.now || new Date().toISOString();

  if (parsed.kind === "canonical" && parsed.value.mode === "manual") {
    const previousSystemTheme = parsed.value.lastSystemTheme;
    if (observedSystemTheme && previousSystemTheme && observedSystemTheme !== previousSystemTheme) {
      return canonicalThemeState({
        effectiveTheme: observedSystemTheme,
        lastSystemTheme: observedSystemTheme,
        mode: "system",
        now,
        source: "system-changed",
      });
    }

    return canonicalThemeState({
      effectiveTheme: parsed.value.manualTheme,
      lastSystemTheme: previousSystemTheme || observedSystemTheme,
      manualTheme: parsed.value.manualTheme,
      mode: "manual",
      now,
      source: observedSystemTheme ? "manual" : "manual-system-unreadable",
      warnings: observedSystemTheme ? [] : ["system-theme-unreadable"],
    });
  }

  if (parsed.kind === "legacy") {
    return canonicalThemeState({
      effectiveTheme: parsed.value,
      lastSystemTheme: observedSystemTheme,
      manualTheme: parsed.value,
      mode: "manual",
      now,
      source: "legacy-migrated",
      warnings: ["legacy-theme-migrated"],
    });
  }

  const warnings = [];
  if (!observedSystemTheme) warnings.push("system-theme-unreadable");
  if (parsed.kind === "invalid") warnings.push("theme-preference-invalid");
  return canonicalThemeState({
    effectiveTheme: observedSystemTheme || "dark",
    lastSystemTheme: observedSystemTheme,
    mode: "system",
    now,
    source: parsed.kind === "canonical" ? "system" : parsed.kind,
    warnings,
  });
}

function chooseManualTheme(currentState, theme, systemTheme, options = {}) {
  const manualTheme = normalizeTheme(theme);
  if (!manualTheme) throw new TypeError("El tema manual debe ser light o dark.");
  const observedSystemTheme = normalizeSystemTheme(systemTheme);
  return canonicalThemeState({
    effectiveTheme: manualTheme,
    lastSystemTheme: observedSystemTheme || currentState?.lastSystemTheme || null,
    manualTheme,
    mode: "manual",
    now: options.now || new Date().toISOString(),
    source: observedSystemTheme ? "manual" : "manual-system-unreadable",
    warnings: observedSystemTheme ? [] : ["system-theme-unreadable"],
  });
}

function persistedThemeState(state) {
  return {
    effectiveTheme: state.effectiveTheme,
    lastSystemTheme: state.lastSystemTheme,
    manualTheme: state.manualTheme,
    mode: state.mode,
    schemaVersion: THEME_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
  };
}

async function ensureThemePreferenceDirectory(directoryPath) {
  try {
    const stats = await fsp.stat(directoryPath);
    if (!stats.isDirectory()) {
      throw createThemePersistenceError(THEME_PERSISTENCE_ERROR_CODES.directoryConflict);
    }
    return;
  } catch (error) {
    if (error?.name === "ThemePersistenceError") throw error;
    if (error?.code !== "ENOENT") throw normalizeThemePersistenceError(error);
  }

  try {
    await fsp.mkdir(directoryPath, { recursive: true });
    const stats = await fsp.stat(directoryPath);
    if (!stats.isDirectory()) {
      throw createThemePersistenceError(THEME_PERSISTENCE_ERROR_CODES.directoryConflict);
    }
  } catch (error) {
    throw normalizeThemePersistenceError(error);
  }
}

function ensureThemePreferenceDirectorySync(directoryPath) {
  try {
    const stats = fs.statSync(directoryPath);
    if (!stats.isDirectory()) {
      throw createThemePersistenceError(THEME_PERSISTENCE_ERROR_CODES.directoryConflict);
    }
    return;
  } catch (error) {
    if (error?.name === "ThemePersistenceError") throw error;
    if (error?.code !== "ENOENT") throw normalizeThemePersistenceError(error);
  }

  try {
    fs.mkdirSync(directoryPath, { recursive: true });
    if (!fs.statSync(directoryPath).isDirectory()) {
      throw createThemePersistenceError(THEME_PERSISTENCE_ERROR_CODES.directoryConflict);
    }
  } catch (error) {
    throw normalizeThemePersistenceError(error);
  }
}

async function assertThemeFileTarget(filePath) {
  try {
    if (!(await fsp.stat(filePath)).isFile()) {
      throw createThemePersistenceError(THEME_PERSISTENCE_ERROR_CODES.fileConflict);
    }
  } catch (error) {
    if (error?.name === "ThemePersistenceError") throw error;
    if (error?.code !== "ENOENT") throw normalizeThemePersistenceError(error);
  }
}

function assertThemeFileTargetSync(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) {
      throw createThemePersistenceError(THEME_PERSISTENCE_ERROR_CODES.fileConflict);
    }
  } catch (error) {
    if (error?.name === "ThemePersistenceError") throw error;
    if (error?.code !== "ENOENT") throw normalizeThemePersistenceError(error);
  }
}

function temporaryThemePath(filePath) {
  return `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
}

async function writeThemeState(filePath, state) {
  const temporaryPath = temporaryThemePath(filePath);
  await ensureThemePreferenceDirectory(path.dirname(filePath));
  await assertThemeFileTarget(filePath);
  try {
    await fsp.writeFile(temporaryPath, JSON.stringify(persistedThemeState(state), null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.unlink(temporaryPath).catch(() => {});
    throw normalizeThemePersistenceError(error);
  }
}

function writeThemeStateSync(filePath, state) {
  const temporaryPath = temporaryThemePath(filePath);
  ensureThemePreferenceDirectorySync(path.dirname(filePath));
  assertThemeFileTargetSync(filePath);
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(persistedThemeState(state), null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw normalizeThemePersistenceError(error);
  }
}

async function readThemePreferenceSource(userDataDir) {
  const filePath = getThemePreferencePath(userDataDir);
  try {
    return { contents: await fsp.readFile(filePath, "utf8"), origin: "canonical", warnings: [] };
  } catch (error) {
    if (error.code !== "ENOENT") {
      return { contents: "{invalid", origin: "canonical", warnings: ["theme-preference-read-failed"] };
    }
  }

  const legacyFilePath = getLegacyThemePreferencePath(userDataDir);
  const legacyDirectoryPath = path.dirname(legacyFilePath);
  try {
    const legacyEntry = await fsp.stat(legacyDirectoryPath);
    if (!legacyEntry.isDirectory()) {
      return { contents: null, origin: "missing", warnings: ["legacy-preferences-file-preserved"] };
    }
  } catch (error) {
    if (error.code === "ENOENT") return { contents: null, origin: "missing", warnings: [] };
    return { contents: null, origin: "missing", warnings: ["legacy-theme-layout-unreadable"] };
  }

  try {
    return {
      contents: await fsp.readFile(legacyFilePath, "utf8"),
      origin: "legacy-layout",
      warnings: ["legacy-theme-layout-migrated"],
    };
  } catch (error) {
    if (error.code === "ENOENT") return { contents: null, origin: "missing", warnings: [] };
    return { contents: "{invalid", origin: "legacy-layout", warnings: ["legacy-theme-layout-unreadable"] };
  }
}

function createThemeAuthority({ now, readSystemTheme, userDataDir }) {
  const filePath = getThemePreferencePath(userDataDir);
  let state = null;
  let initialPreferenceKind = "missing";
  let mutationTail = Promise.resolve();

  function observeSystemTheme() {
    try {
      return normalizeSystemTheme(readSystemTheme?.());
    } catch {
      return null;
    }
  }

  async function initialize() {
    const preferenceSource = await readThemePreferenceSource(userDataDir);
    const contents = preferenceSource.contents;
    initialPreferenceKind = parseThemePreference(contents).kind;
    let next = resolveThemeForStartup(contents, observeSystemTheme(), { now: now?.() });
    next = {
      ...next,
      source: preferenceSource.origin === "legacy-layout" ? `${next.source}-legacy-layout` : next.source,
      warnings: [...new Set([...next.warnings, ...preferenceSource.warnings])],
    };
    try {
      await writeThemeState(filePath, next);
    } catch (error) {
      next = { ...next, warnings: [...new Set([...next.warnings, themePersistenceErrorCode(error)])] };
    }
    state = next;
    return getState();
  }

  function getState() {
    return state ? { ...state, warnings: [...state.warnings] } : null;
  }

  function canMigrateRendererLegacyTheme() {
    return initialPreferenceKind === "missing" || initialPreferenceKind === "invalid";
  }

  function migrateRendererLegacyThemeSync(theme) {
    if (!canMigrateRendererLegacyTheme()) return getState();
    const legacyTheme = normalizeTheme(theme);
    if (!legacyTheme) return getState();
    const next = canonicalThemeState({
      effectiveTheme: legacyTheme,
      lastSystemTheme: observeSystemTheme(),
      manualTheme: legacyTheme,
      mode: "manual",
      now: now?.() || new Date().toISOString(),
      source: "renderer-legacy-migrated",
      warnings: ["legacy-theme-migrated"],
    });
    writeThemeStateSync(filePath, next);
    state = next;
    initialPreferenceKind = "canonical";
    return getState();
  }

  async function setManualTheme(theme) {
    const operation = mutationTail.then(async () => {
      const next = chooseManualTheme(state, theme, observeSystemTheme(), { now: now?.() });
      await writeThemeState(filePath, next);
      state = next;
      return getState();
    });
    mutationTail = operation.catch(() => {});
    return operation;
  }

  return {
    canMigrateRendererLegacyTheme,
    getState,
    initialize,
    migrateRendererLegacyThemeSync,
    setManualTheme,
  };
}

module.exports = {
  THEME_SCHEMA_VERSION,
  VALID_MODES,
  VALID_THEMES,
  canonicalThemeState,
  chooseManualTheme,
  createThemeAuthority,
  getLegacyThemePreferencePath,
  getThemePreferenceDirectory,
  getThemePreferencePath,
  normalizeSystemTheme,
  normalizeTheme,
  parseThemePreference,
  persistedThemeState,
  resolveThemeForStartup,
  readThemePreferenceSource,
  THEME_PERSISTENCE_ERROR_CODES,
  themePersistenceErrorCode,
  themeBackgroundColor,
  writeThemeState,
};
