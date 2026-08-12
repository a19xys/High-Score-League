const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { rememberAccount, removeKnownAccount } = require("../src/account-store");
const { writeLibraryPreferences } = require("../src/library-preferences");
const { playerPreferenceScope, resolvePlayerPreferenceScope } = require("../src/preference-scope");
const {
  createThemeAuthority,
  getThemePreferencePath,
  themeBackgroundColor,
  writeThemeState,
} = require("../src/theme-preferences");
const {
  getLauncherState,
  setLibraryPreferencesFromGui,
} = require("../gui/launcher-service");

const canonicalTheme = (theme) => ({
  effectiveTheme: theme,
  lastSystemTheme: "dark",
  manualTheme: theme,
  mode: "manual",
  schemaVersion: 1,
  updatedAt: "2026-08-12T10:00:00.000Z",
});

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-player-preferences-integration-"));
  try {
    return await run({ userDataDir: path.join(root, "userData") });
  } finally {
    await fsp.rm(root, { force: true, recursive: true });
  }
}

test("getLauncherState usa lastActiveUserId para Biblioteca aunque no exista sesión remota utilizable", async () => {
  await withTempDir(async (config) => {
    const a = playerPreferenceScope("A");
    await rememberAccount(config, { email: "a@example.test", userId: "A" }, { requiresLogin: true });
    await writeLibraryPreferences(config, a, {
      librarySortBy: "title",
      librarySortDirection: "desc",
      libraryView: "icons",
      sidebarWidth: 560,
    });
    const state = await getLauncherState({ config, deferRemoteMembership: true });
    assert.equal(state.session.hasSession, false);
    assert.equal(state.preferenceScope.scopeKey, a.scopeKey);
    assert.deepEqual(
      [state.library.preferences.libraryView, state.library.preferences.librarySortBy, state.library.preferences.librarySortDirection, state.library.preferences.sidebarWidth],
      ["icons", "title", "desc", 560],
    );
    assert.equal(state.library.preferences.filePath, undefined);
  });
});

test("main valida scope lógico de writes y nunca acepta una ruta del renderer", async () => {
  await withTempDir(async (config) => {
    const a = playerPreferenceScope("A");
    const b = playerPreferenceScope("B");
    await rememberAccount(config, { userId: "A" });
    await assert.rejects(() => setLibraryPreferencesFromGui({
      filePath: "C:/renderer-controlled/library.json",
      libraryView: "icons",
      scopeKey: b.scopeKey,
    }, { config, includeState: false }), (error) => error.code === "PREFERENCE_SCOPE_STALE");
    const accepted = await setLibraryPreferencesFromGui({
      filePath: "C:/renderer-controlled/library.json",
      libraryView: "icons",
      scopeKey: a.scopeKey,
    }, { config, includeState: false });
    assert.equal(accepted.preferences.scopeKey, a.scopeKey);
    assert.equal(accepted.preferences.filePath, undefined);
    assert.doesNotMatch(JSON.stringify(accepted), /renderer-controlled|userData|library\.json/);
  });
});

test("startup resuelve cuenta y tema local antes del BrowserWindow sin depender de red", async () => {
  await withTempDir(async (config) => {
    const a = playerPreferenceScope("A");
    await rememberAccount(config, { userId: "A" });
    await writeThemeState(getThemePreferencePath(config.userDataDir), canonicalTheme("dark"));
    await writeThemeState(getThemePreferencePath(config.userDataDir, a), canonicalTheme("light"));
    const scope = await resolvePlayerPreferenceScope(config);
    const authority = createThemeAuthority({ readSystemTheme: () => "dark", userDataDir: config.userDataDir });
    const theme = await authority.initialize(scope);
    assert.equal(scope.scopeKey, a.scopeKey);
    assert.equal(theme.effectiveTheme, "light");
    assert.equal(themeBackgroundColor(theme.effectiveTheme), "#eef4fb");
  });
});

test("olvidar o cerrar una cuenta no elimina sus preferencias scoped", async () => {
  await withTempDir(async (config) => {
    const a = playerPreferenceScope("A");
    await rememberAccount(config, { userId: "A" });
    const library = await writeLibraryPreferences(config, a, { libraryView: "icons" });
    await writeThemeState(getThemePreferencePath(config.userDataDir, a), canonicalTheme("light"));
    await removeKnownAccount(config, "A");
    assert.equal((await fsp.stat(library.filePath)).isFile(), true);
    assert.equal((await fsp.stat(getThemePreferencePath(config.userDataDir, a))).isFile(), true);
  });
});

test("main y renderer coordinan scope, tema y Biblioteca sin reload ni paths expuestos", async () => {
  const [main, preload, renderer, scopedQueue] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "preload.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "src", "scoped-queue.js"), "utf8"),
  ]);
  const startupScope = main.lastIndexOf("const startupPreferenceScope = await resolvePlayerPreferenceScope");
  const startupTheme = main.lastIndexOf("await themeAuthority.initialize(startupPreferenceScope)");
  const createWindow = main.lastIndexOf("createMainWindow();");
  assert.ok(startupScope >= 0 && startupScope < startupTheme && startupTheme < createWindow);
  assert.match(main, /enrichPreferenceState[\s\S]*themeAuthority\.switchScope/);
  assert.match(main, /coordinatePreferenceResult[\s\S]*enrichPreferenceState\(sourceState,/);
  assert.match(main, /preferences:\s*\{[\s\S]*scope: preferenceScope,[\s\S]*theme: publicTheme/);
  assert.match(main, /applyNativeWindowTheme\(mainWindow, publicTheme\.effectiveTheme\)/);
  assert.match(renderer, /data: nextData,[\s\S]*libraryPreferencesStatePatch\(nextData, current[\s\S]*themeStatePatch\(nextData\)/);
  assert.match(renderer, /flushPendingLibraryPreferences\(\)[\s\S]*window\.hslLauncher\.switchAccount/);
  assert.match(renderer, /scopeKey: libraryPreferencesScopeKey\(snapshotPreferenceScope\(current\.data\)\)/);
  assert.match(preload, /setLibraryPreferences: \(patch\)/);
  assert.doesNotMatch(preload, /setLibraryPreferences[\s\S]{0,120}filePath/);
  assert.match(scopedQueue, /function derivePlayerKey\(session\) \{\s*if \(!session\?\.hasSession\)/);
  assert.doesNotMatch(main + renderer, /location\.reload|BrowserWindow\.reload|mainWindow\.reload/);
});
