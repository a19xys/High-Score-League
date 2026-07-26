const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  chooseManualTheme,
  createThemeAuthority,
  getLegacyThemePreferencePath,
  getThemePreferenceDirectory,
  getThemePreferencePath,
  parseThemePreference,
  resolveThemeForStartup,
  THEME_PERSISTENCE_ERROR_CODES,
  themeBackgroundColor,
  writeThemeState,
} = require("../src/theme-preferences");

const now = "2026-07-26T12:00:00.000Z";
const canonical = (patch = {}) => JSON.stringify({
  effectiveTheme: "light",
  lastSystemTheme: "dark",
  manualTheme: "light",
  mode: "manual",
  schemaVersion: 1,
  updatedAt: now,
  ...patch,
});

test("first startup follows readable light and dark system themes", () => {
  assert.equal(resolveThemeForStartup(null, "light", { now }).effectiveTheme, "light");
  assert.equal(resolveThemeForStartup(null, "dark", { now }).effectiveTheme, "dark");
  assert.equal(resolveThemeForStartup(null, "light", { now }).mode, "system");
});

test("an unreadable system uses the safe dark derived fallback", () => {
  const state = resolveThemeForStartup(null, null, { now });
  assert.equal(state.effectiveTheme, "dark");
  assert.equal(state.lastSystemTheme, null);
  assert.deepEqual(state.warnings, ["system-theme-unreadable"]);
});

test("manual light and dark persist while the observed system has not changed", () => {
  assert.equal(resolveThemeForStartup(canonical(), "dark", { now }).effectiveTheme, "light");
  assert.equal(resolveThemeForStartup(canonical({ effectiveTheme: "dark", lastSystemTheme: "light", manualTheme: "dark" }), "light", { now }).effectiveTheme, "dark");
});

test("manual choice may differ from the system and records its observation", () => {
  const state = chooseManualTheme(resolveThemeForStartup(null, "dark", { now }), "light", "dark", { now });
  assert.equal(state.mode, "manual");
  assert.equal(state.manualTheme, "light");
  assert.equal(state.lastSystemTheme, "dark");
});

test("a later system change abandons manual mode on the next startup", () => {
  const changed = resolveThemeForStartup(canonical(), "light", { now });
  assert.equal(changed.mode, "system");
  assert.equal(changed.effectiveTheme, "light");
  const following = resolveThemeForStartup(JSON.stringify(changed), "dark", { now });
  assert.equal(following.mode, "system");
  assert.equal(following.effectiveTheme, "dark");
});

test("an unreadable system never erases a valid manual choice", () => {
  const state = resolveThemeForStartup(canonical(), null, { now });
  assert.equal(state.mode, "manual");
  assert.equal(state.effectiveTheme, "light");
  assert.equal(state.lastSystemTheme, "dark");
});

test("legacy string and object themes migrate as manual choices", () => {
  for (const contents of ["light", JSON.stringify("dark"), JSON.stringify({ theme: "light" })]) {
    const state = resolveThemeForStartup(contents, "dark", { now });
    assert.equal(state.mode, "manual");
    assert.ok(["light", "dark"].includes(state.manualTheme));
    assert.equal(state.lastSystemTheme, "dark");
  }
});

test("corrupt preferences recover without a migration loop", () => {
  assert.equal(parseThemePreference("{broken").kind, "invalid");
  const recovered = resolveThemeForStartup("{broken", null, { now });
  assert.equal(recovered.effectiveTheme, "dark");
  assert.equal(recovered.mode, "system");
});

test("theme authority persists one canonical contract and rejects failed manual writes", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-"));
  try {
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    assert.equal((await authority.initialize()).effectiveTheme, "dark");
    assert.equal((await authority.setManualTheme("light")).effectiveTheme, "light");
    const raw = JSON.parse(await fsp.readFile(getThemePreferencePath(directory), "utf8"));
    assert.deepEqual(Object.keys(raw).sort(), ["effectiveTheme", "lastSystemTheme", "manualTheme", "mode", "schemaVersion", "updatedAt"]);
    assert.equal(raw.mode, "manual");
    assert.equal(raw.lastSystemTheme, "dark");
    assert.equal(getThemePreferencePath(directory), path.join(directory, "hsl", "preferences", "theme.json"));
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("an existing canonical preferences directory is idempotent", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-existing-dir-"));
  try {
    await fsp.mkdir(getThemePreferenceDirectory(directory), { recursive: true });
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "light", userDataDir: directory });
    assert.equal((await authority.initialize()).effectiveTheme, "light");
    assert.equal((await fsp.stat(getThemePreferenceDirectory(directory))).isDirectory(), true);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("a file occupying the canonical directory is preserved and classified", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-dir-conflict-"));
  try {
    const preferenceDirectory = getThemePreferenceDirectory(directory);
    await fsp.mkdir(path.dirname(preferenceDirectory), { recursive: true });
    await fsp.writeFile(preferenceDirectory, "do-not-delete", "utf8");
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    const initial = await authority.initialize();
    assert.ok(initial.warnings.includes(THEME_PERSISTENCE_ERROR_CODES.directoryConflict));
    await assert.rejects(
      () => authority.setManualTheme("light"),
      (error) => error.code === THEME_PERSISTENCE_ERROR_CODES.directoryConflict,
    );
    assert.equal(await fsp.readFile(preferenceDirectory, "utf8"), "do-not-delete");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("an existing canonical theme file is read and atomically replaced", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-existing-file-"));
  try {
    const filePath = getThemePreferencePath(directory);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, canonical(), "utf8");
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    assert.equal((await authority.initialize()).effectiveTheme, "light");
    assert.equal((await authority.setManualTheme("dark")).effectiveTheme, "dark");
    assert.equal(JSON.parse(await fsp.readFile(filePath, "utf8")).manualTheme, "dark");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("consecutive and overlapping writes are serialized with the last choice intact", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-concurrent-"));
  try {
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    await authority.initialize();
    await authority.setManualTheme("light");
    await authority.setManualTheme("dark");
    const overlapping = await Promise.all([
      authority.setManualTheme("light"),
      authority.setManualTheme("dark"),
      authority.setManualTheme("light"),
    ]);
    assert.deepEqual(overlapping.map((state) => state.effectiveTheme), ["light", "dark", "light"]);
    const raw = JSON.parse(await fsp.readFile(getThemePreferencePath(directory), "utf8"));
    assert.equal(raw.manualTheme, "light");
    const entries = await fsp.readdir(getThemePreferenceDirectory(directory));
    assert.deepEqual(entries, ["theme.json"]);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("a persisted manual choice is recovered by a new authority after restart", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-restart-"));
  try {
    const first = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    await first.initialize();
    await first.setManualTheme("light");
    const second = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    const restored = await second.initialize();
    assert.equal(restored.mode, "manual");
    assert.equal(restored.effectiveTheme, "light");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("the attempted 3B.2 layout migrates by copy when preferences is a directory", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-layout-migration-"));
  try {
    const legacyPath = getLegacyThemePreferencePath(directory);
    await fsp.mkdir(path.dirname(legacyPath), { recursive: true });
    await fsp.writeFile(legacyPath, canonical(), "utf8");
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    const migrated = await authority.initialize();
    assert.equal(migrated.effectiveTheme, "light");
    assert.ok(migrated.warnings.includes("legacy-theme-layout-migrated"));
    assert.equal(JSON.parse(await fsp.readFile(getThemePreferencePath(directory), "utf8")).manualTheme, "light");
    assert.equal(JSON.parse(await fsp.readFile(legacyPath, "utf8")).manualTheme, "light");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("Electron's native preferences file is preserved and never treated as a directory", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-native-preferences-"));
  try {
    const nativePreferencesPath = path.join(directory, "preferences");
    const nativeContents = JSON.stringify({ electron: {}, partition: {}, spellcheck: {} });
    await fsp.writeFile(nativePreferencesPath, nativeContents, "utf8");
    const authority = createThemeAuthority({ now: () => now, readSystemTheme: () => "dark", userDataDir: directory });
    const initial = await authority.initialize();
    assert.ok(initial.warnings.includes("legacy-preferences-file-preserved"));
    assert.equal((await authority.setManualTheme("light")).effectiveTheme, "light");
    assert.equal(await fsp.readFile(nativePreferencesPath, "utf8"), nativeContents);
    assert.equal(JSON.parse(await fsp.readFile(getThemePreferencePath(directory), "utf8")).manualTheme, "light");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("atomic writes leave no partial file and persist only the public theme schema", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-theme-atomic-"));
  try {
    const filePath = getThemePreferencePath(directory);
    await writeThemeState(filePath, {
      ...JSON.parse(canonical()),
      accessToken: "must-not-persist",
      password: "must-not-persist",
      session: { secret: "must-not-persist" },
    });
    const rawText = await fsp.readFile(filePath, "utf8");
    const raw = JSON.parse(rawText);
    assert.deepEqual(Object.keys(raw).sort(), ["effectiveTheme", "lastSystemTheme", "manualTheme", "mode", "schemaVersion", "updatedAt"]);
    assert.doesNotMatch(rawText, /accessToken|password|session|secret|must-not-persist/);
    assert.deepEqual(await fsp.readdir(getThemePreferenceDirectory(directory)), ["theme.json"]);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("native window colors correspond to the effective theme", () => {
  assert.equal(themeBackgroundColor("light"), "#eef4fb");
  assert.equal(themeBackgroundColor("dark"), "#0f172a");
});
