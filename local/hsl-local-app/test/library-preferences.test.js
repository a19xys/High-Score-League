const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  migrateLibraryFavoriteKey,
  readLibraryFavorites,
  readLibraryPreferences,
  toggleLibraryFavorite,
  writeLibraryFavorites,
  writeLibraryPreferences,
} = require("../src/library-preferences");
const { playerPreferenceScope } = require("../src/preference-scope");
const { atomicWriteJson } = require("../src/secure-session-storage");
const { rememberAccount, removeKnownAccount } = require("../src/account-store");

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
      librarySortBy: "title",
      librarySortDirection: "desc",
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
    assert.equal(prefsA.librarySortBy, "title");
    assert.equal(prefsA.librarySortDirection, "desc");
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
      librarySortBy: "bad-sort",
      librarySortDirection: "sideways",
      libraryView: "bad-view",
      sidebarWidth: 9999,
    }, { now: "2026-06-27T00:00:00.000Z" });

    const prefs = await readLibraryPreferences(config(dir), { hasSession: false });

    assert.equal(prefs.libraryView, "covers");
    assert.equal(prefs.librarySortBy, "weeks");
    assert.equal(prefs.librarySortDirection, "asc");
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
    assert.equal(prefs.librarySortBy, "weeks");
    assert.equal(prefs.librarySortDirection, "asc");
    assert.equal(prefs.sidebarWidth, 440);
    assert.equal(prefs.warnings.length, 1);
  });
});

test("favoritos sin sesion no se escriben como perfil anonimo nuevo", async () => {
  await withTempDir(async (dir) => {
    const first = await toggleLibraryFavorite(config(dir), "space-invaders-week-1", {
      now: "2026-06-27T00:00:00.000Z",
    });
    const second = await toggleLibraryFavorite(config(dir), "space-invaders-week-1", {
      now: "2026-06-27T00:00:01.000Z",
    });
    const stored = await readLibraryFavorites(config(dir));
    const filePath = path.join(config(dir).userDataDir, "library", "favorites.json");

    assert.equal(first.disabled, true);
    assert.equal(first.favorites["space-invaders-week-1"], undefined);
    assert.equal(second.disabled, true);
    assert.equal(second.favorites["space-invaders-week-1"], undefined);
    assert.equal(stored.favorites["space-invaders-week-1"], undefined);
    assert.match(stored.filePath, /library[\\/]favorites\.json$/);
    await assert.rejects(fsp.stat(filePath), /ENOENT/);
  });
});

test("favoritos de biblioteca se guardan por playerKey", async () => {
  await withTempDir(async (dir) => {
    const sessionA = { email: "test3@gmail.com", hasSession: true, userId: "user-a" };
    const sessionB = { email: "other@gmail.com", hasSession: true, userId: "user-b" };

    const favoriteA = await toggleLibraryFavorite(config(dir), "space-invaders-week-1", {
      now: "2026-06-27T00:00:00.000Z",
      session: sessionA,
    });
    const storedA = await readLibraryFavorites(config(dir), sessionA);
    const storedB = await readLibraryFavorites(config(dir), sessionB);
    const anonymous = await readLibraryFavorites(config(dir), { hasSession: false });

    assert.equal(favoriteA.favorites["space-invaders-week-1"], true);
    assert.equal(storedA.favorites["space-invaders-week-1"], true);
    assert.equal(storedA.scope, "player");
    assert.match(storedA.filePath, /players[\\/]user_user-a[\\/]preferences[\\/]favorites\.json$/);
    assert.equal(storedB.favorites["space-invaders-week-1"], undefined);
    assert.equal(anonymous.favorites["space-invaders-week-1"], undefined);
  });
});

test("favoritos legacy anonimos no se mezclan con favoritos de cuenta", async () => {
  await withTempDir(async (dir) => {
    const session = { email: "test3@gmail.com", hasSession: true, userId: "user-a" };
    const filePath = path.join(config(dir).userDataDir, "library", "favorites.json");

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify({
      favorites: { "anonymous-pack": true },
      schemaVersion: 1,
      updatedAt: "2026-06-27T00:00:00.000Z",
    }), "utf8");
    const anonymous = await readLibraryFavorites(config(dir));
    const account = await readLibraryFavorites(config(dir), session);

    assert.equal(anonymous.favorites["anonymous-pack"], true);
    assert.equal(anonymous.scope, "global");
    assert.match(anonymous.filePath, /library[\\/]favorites\.json$/);
    assert.equal(account.favorites["anonymous-pack"], undefined);
  });
});

test("olvidar una cuenta no borra sus favoritos locales", async () => {
  await withTempDir(async (dir) => {
    const session = { email: "test3@gmail.com", hasSession: true, userId: "user-a" };

    await rememberAccount(config(dir), { email: session.email, userId: session.userId });
    await toggleLibraryFavorite(config(dir), "space-invaders-week-1", {
      now: "2026-06-27T00:00:00.000Z",
      session,
    });

    const removed = await removeKnownAccount(config(dir), session.userId);
    const stored = await readLibraryFavorites(config(dir), session);

    assert.equal(removed.removed, true);
    assert.equal(stored.favorites["space-invaders-week-1"], true);
  });
});

test("favoritos corruptos por cuenta no crashean y caen a vacio", async () => {
  await withTempDir(async (dir) => {
    const session = { email: "test3@gmail.com", hasSession: true, userId: "user-a" };
    const filePath = path.join(config(dir).userDataDir, "players", "user_user-a", "preferences", "favorites.json");
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, "{", "utf8");

    const favorites = await readLibraryFavorites(config(dir), session);

    assert.deepEqual(favorites.favorites, {});
    assert.equal(favorites.scope, "player");
    assert.equal(favorites.warnings.length, 1);
  });
});

test("migración de favorito old→target es local, deduplicada e idempotente", async () => {
  await withTempDir(async (dir) => {
    const localConfig = config(dir);
    const sessionA = { hasSession: true, userId: "user-a" };
    const sessionB = { hasSession: true, userId: "user-b" };
    await writeLibraryFavorites(localConfig, {}, { old: true, untouched: true });
    await writeLibraryFavorites(localConfig, sessionA, { old: true, target: true, other: true });
    await writeLibraryFavorites(localConfig, sessionB, { other: true });

    const first = await migrateLibraryFavoriteKey(localConfig, "old", "target", { now: "2026-08-24T10:00:00.000Z" });
    const second = await migrateLibraryFavoriteKey(localConfig, "old", "target", { now: "2026-08-24T10:00:01.000Z" });
    assert.equal(first.changedFiles, 2);
    assert.equal(second.changedFiles, 0);
    assert.deepEqual((await readLibraryFavorites(localConfig)).favorites, { target: true, untouched: true });
    assert.deepEqual((await readLibraryFavorites(localConfig, sessionA)).favorites, { target: true, other: true });
    assert.deepEqual((await readLibraryFavorites(localConfig, sessionB)).favorites, { other: true });
  });
});

test("clampSidebarWidth respeta limites seguros", () => {
  assert.equal(clampSidebarWidth(1), MIN_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(9999), MAX_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(455.4), 455);
});

test("A, B y global conservan snapshots completos e independientes", async () => {
  await withTempDir(async (dir) => {
    const a = playerPreferenceScope("A");
    const b = playerPreferenceScope("B");
    await Promise.all([
      writeLibraryPreferences(config(dir), a, { libraryView: "icons", librarySortBy: "title", librarySortDirection: "desc", sidebarWidth: 560 }),
      writeLibraryPreferences(config(dir), b, { libraryView: "covers", librarySortBy: "weeks", librarySortDirection: "asc", sidebarWidth: 360 }),
      writeLibraryPreferences(config(dir), { scope: "global" }, { libraryView: "list", librarySortBy: "developer", librarySortDirection: "asc", sidebarWidth: 440 }),
    ]);
    const [storedA, storedB, global] = await Promise.all([
      readLibraryPreferences(config(dir), a),
      readLibraryPreferences(config(dir), b),
      readLibraryPreferences(config(dir), { scope: "global" }),
    ]);
    assert.deepEqual(
      [storedA.libraryView, storedA.librarySortBy, storedA.librarySortDirection, storedA.sidebarWidth],
      ["icons", "title", "desc", 560],
    );
    assert.deepEqual(
      [storedB.libraryView, storedB.librarySortBy, storedB.librarySortDirection, storedB.sidebarWidth],
      ["covers", "weeks", "asc", 360],
    );
    assert.deepEqual(
      [global.libraryView, global.librarySortBy, global.librarySortDirection, global.sidebarWidth],
      ["list", "developer", "asc", 440],
    );
  });
});

test("writes se serializan por scope, A lento no bloquea ni contamina B y la última A gana", async () => {
  await withTempDir(async (dir) => {
    const a = playerPreferenceScope("A");
    const b = playerPreferenceScope("B");
    let releaseA;
    const waitA = new Promise((resolve) => { releaseA = resolve; });
    let startedA;
    const aStarted = new Promise((resolve) => { startedA = resolve; });
    const delayedAtomicWrite = async (filePath, value) => {
      if (filePath.includes(`${path.sep}${a.playerKey}${path.sep}`) && value.libraryView === "list") {
        startedA();
        await waitA;
      }
      return atomicWriteJson(filePath, value);
    };

    const firstA = writeLibraryPreferences(config(dir), a, { libraryView: "list" }, { atomicWriteImpl: delayedAtomicWrite });
    await aStarted;
    const secondA = writeLibraryPreferences(config(dir), a, { libraryView: "icons" }, { atomicWriteImpl: delayedAtomicWrite });
    const writeB = writeLibraryPreferences(config(dir), b, { libraryView: "covers", sidebarWidth: 360 }, { atomicWriteImpl: delayedAtomicWrite });
    assert.equal((await writeB).scopeKey, b.scopeKey);
    releaseA();
    await Promise.all([firstA, secondA]);

    assert.equal((await readLibraryPreferences(config(dir), a)).libraryView, "icons");
    assert.equal((await readLibraryPreferences(config(dir), b)).libraryView, "covers");
  });
});

test("fallo de escritura atómica conserva el library.json anterior completo", async () => {
  await withTempDir(async (dir) => {
    const a = playerPreferenceScope("A");
    await writeLibraryPreferences(config(dir), a, { libraryView: "covers", sidebarWidth: 500 });
    const filePath = (await readLibraryPreferences(config(dir), a)).filePath;
    const before = await fsp.readFile(filePath, "utf8");
    await assert.rejects(() => writeLibraryPreferences(config(dir), a, { libraryView: "icons" }, {
      atomicWriteImpl: async () => { throw new Error("fixture-write-failed"); },
    }), /fixture-write-failed/);
    assert.equal(await fsp.readFile(filePath, "utf8"), before);
    assert.deepEqual(await fsp.readdir(path.dirname(filePath)), ["library.json"]);
  });
});
