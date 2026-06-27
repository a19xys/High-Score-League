const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  readLibraryFavorites,
  readLibraryPreferences,
  toggleLibraryFavorite,
  writeLibraryPreferences,
} = require("../src/library-preferences");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-library-preferences-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function config(root) {
  return {
    userDataDir: path.join(root, "userData"),
  };
}

test("preferencias de biblioteca se guardan por playerKey", async () => {
  await withTempDir(async (dir) => {
    const sessionA = { email: "test3@gmail.com", hasSession: true, userId: "user-a" };
    const sessionB = { email: "other@gmail.com", hasSession: true, userId: "user-b" };

    await writeLibraryPreferences(config(dir), sessionA, {
      libraryView: "list",
      sidebarWidth: 510,
    }, { now: "2026-06-27T00:00:00.000Z" });
    await writeLibraryPreferences(config(dir), sessionB, {
      libraryView: "icons",
      sidebarWidth: 390,
    }, { now: "2026-06-27T00:00:00.000Z" });

    const prefsA = await readLibraryPreferences(config(dir), sessionA);
    const prefsB = await readLibraryPreferences(config(dir), sessionB);

    assert.equal(prefsA.libraryView, "list");
    assert.equal(prefsA.sidebarWidth, 510);
    assert.equal(prefsA.scope, "player");
    assert.match(prefsA.filePath, /players/);
    assert.equal(prefsB.libraryView, "icons");
    assert.equal(prefsB.sidebarWidth, 390);
  });
});

test("preferencias sin sesion usan fallback global y validan valores", async () => {
  await withTempDir(async (dir) => {
    await writeLibraryPreferences(config(dir), { hasSession: false }, {
      libraryView: "bad-view",
      sidebarWidth: 9999,
    }, { now: "2026-06-27T00:00:00.000Z" });

    const prefs = await readLibraryPreferences(config(dir), { hasSession: false });

    assert.equal(prefs.libraryView, "covers");
    assert.equal(prefs.sidebarWidth, MAX_SIDEBAR_WIDTH);
    assert.equal(prefs.scope, "global");
    assert.match(prefs.filePath, /library[\\/]preferences\.json$/);
  });
});

test("preferencias corruptas no crashean y caen a defaults", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(config(dir).userDataDir, "library", "preferences.json");
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, "{", "utf8");

    const prefs = await readLibraryPreferences(config(dir), { hasSession: false });

    assert.equal(prefs.libraryView, "covers");
    assert.equal(prefs.sidebarWidth, 440);
    assert.equal(prefs.warnings.length, 1);
  });
});

test("favoritos locales alternan por clave de pack sin sesion", async () => {
  await withTempDir(async (dir) => {
    const first = await toggleLibraryFavorite(config(dir), "space-invaders-week-1", {
      now: "2026-06-27T00:00:00.000Z",
    });
    const second = await toggleLibraryFavorite(config(dir), "space-invaders-week-1", {
      now: "2026-06-27T00:00:01.000Z",
    });
    const stored = await readLibraryFavorites(config(dir));

    assert.equal(first.favorites["space-invaders-week-1"], true);
    assert.equal(second.favorites["space-invaders-week-1"], undefined);
    assert.equal(stored.favorites["space-invaders-week-1"], undefined);
    assert.match(stored.filePath, /library[\\/]favorites\.json$/);
  });
});

test("clampSidebarWidth respeta limites seguros", () => {
  assert.equal(clampSidebarWidth(1), MIN_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(9999), MAX_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(455.4), 455);
});
