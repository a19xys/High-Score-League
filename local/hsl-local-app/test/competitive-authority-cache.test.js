const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  CACHE_SCHEMA_VERSION,
  authorityContextKey,
  createMembershipCache,
  createWeekCapabilityCache,
  membershipCachePath,
  weekCachePath,
} = require("../src/competitive-authority-cache");

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-authority-cache-"));
  try { return await run(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

const context = { authorityKey: "launcher-api:1", origin: "https://hsl.example" };
const legacyContext = { authorityKey: "launcher-api:1", origin: "https://high-score-league.vercel.app" };
const canonicalContext = { authorityKey: "launcher-api:1", origin: "https://highscoreleague.com" };

function weekEntry(key, overrides = {}) {
  return {
    checkedAt: "2026-08-01T00:00:00.000Z",
    conclusive: true,
    key,
    publicState: "active",
    reason: "week-active",
    seasonId: "season-a",
    seasonStatus: "active",
    weekId: "week-a",
    ...overrides,
  };
}

function membershipEntry(key, overrides = {}) {
  return {
    checkedAt: "2026-08-01T00:00:00.000Z",
    key,
    seasonId: "season-a",
    status: "member",
    userId: "user-a",
    ...overrides,
  };
}

test("Week v2 es durable por origin + launcher API y no contiene build/environment", async () => {
  await withTempDir(async (userDataDir) => {
    const config = { userDataDir };
    const cache = createWeekCapabilityCache(config);
    await cache.initialize();
    await cache.remember(context, {
      checkedAt: "2026-08-01T00:00:00.000Z",
      conclusive: true,
      derivedStatus: "scheduled",
      finalDeadlineAt: "2026-08-03T00:00:00.000Z",
      publicStartAt: "2026-08-02T00:00:00.000Z",
      publicState: "inactive",
      rawStatus: "draft",
      reason: "week-inactive",
      seasonId: "season-a",
      weekId: "week-a",
    });
    assert.equal(cache.read(context, "week-a", Date.parse("2026-08-01T12:00:00Z")).publicState, "inactive");
    assert.equal(cache.read(context, "week-a", Date.parse("2026-08-02T12:00:00Z")).publicState, "active");
    assert.equal(cache.read(context, "week-a", Date.parse("2026-08-03T00:00:00Z")).publicState, "closed");
    assert.equal(cache.read({ ...context, origin: "https://other.example" }, "week-a"), null);
    assert.deepEqual(cache.snapshot().entries.map((entry) => entry.key), [
      "https://hsl.example|launcher-api:1|week:week-a",
    ]);

    const restarted = createWeekCapabilityCache(config);
    await restarted.initialize();
    assert.equal(restarted.read(context, "week-a", Date.parse("2026-08-02T12:00:00Z")).seasonId, "season-a");
    assert.equal(restarted.path, weekCachePath(config));
  });
});

test("Membership v2 conserva solo conclusiones y aísla cuenta, season y origin", async () => {
  await withTempDir(async (userDataDir) => {
    const config = { userDataDir };
    const cache = createMembershipCache(config);
    await cache.initialize();
    await cache.remember(context, { checkedAt: "2026-08-01T00:00:00Z", seasonId: "season-a", status: "member", userId: "user-a" });
    await cache.remember(context, { checkedAt: "2026-08-01T00:01:00Z", seasonId: "season-a", status: "unknown", userId: "user-a" });
    assert.equal(cache.read(context, "user-a", "season-a").status, "member");
    assert.equal(cache.read(context, "user-b", "season-a"), null);
    assert.equal(cache.read(context, "user-a", "season-b"), null);
    assert.equal(cache.read({ ...context, origin: "https://other.example" }, "user-a", "season-a"), null);
    assert.equal(cache.snapshot().entries[0].key, "https://hsl.example|launcher-api:1|user:user-a|season:season-a");
    assert.equal(cache.path, membershipCachePath(config));
  });
});

test("upgrade conserva las entradas legacy y abre namespaces Week/Membership fríos para el apex", async () => {
  await withTempDir(async (userDataDir) => {
    const config = { userDataDir };
    const legacyWeekCache = createWeekCapabilityCache(config);
    const legacyMembershipCache = createMembershipCache(config);
    await Promise.all([legacyWeekCache.initialize(), legacyMembershipCache.initialize()]);

    assert.notEqual(authorityContextKey(legacyContext), authorityContextKey(canonicalContext));
    await legacyWeekCache.remember(legacyContext, {
      checkedAt: "2026-08-01T00:00:00.000Z",
      conclusive: true,
      publicState: "active",
      reason: "week-active",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    await legacyMembershipCache.remember(legacyContext, {
      checkedAt: "2026-08-01T00:00:00.000Z",
      seasonId: "season-a",
      status: "member",
      userId: "user-a",
    });

    const upgradedWeekCache = createWeekCapabilityCache(config);
    const upgradedMembershipCache = createMembershipCache(config);
    await Promise.all([upgradedWeekCache.initialize(), upgradedMembershipCache.initialize()]);
    assert.equal(upgradedWeekCache.read(canonicalContext, "week-a"), null);
    assert.equal(upgradedMembershipCache.read(canonicalContext, "user-a", "season-a"), null);

    await upgradedWeekCache.remember(canonicalContext, {
      checkedAt: "2026-08-02T00:00:00.000Z",
      conclusive: true,
      publicState: "closed",
      reason: "week-closed",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-a",
    });
    await upgradedMembershipCache.remember(canonicalContext, {
      checkedAt: "2026-08-02T00:00:00.000Z",
      seasonId: "season-a",
      status: "not_member",
      userId: "user-a",
    });

    assert.equal(upgradedWeekCache.read(legacyContext, "week-a").publicState, "active");
    assert.equal(upgradedWeekCache.read(canonicalContext, "week-a").publicState, "closed");
    assert.equal(upgradedMembershipCache.read(legacyContext, "user-a", "season-a").status, "member");
    assert.equal(upgradedMembershipCache.read(canonicalContext, "user-a", "season-a").status, "not_member");

    const persistedWeek = JSON.parse(await fsp.readFile(weekCachePath(config), "utf8"));
    const persistedMembership = JSON.parse(await fsp.readFile(membershipCachePath(config), "utf8"));
    for (const persisted of [persistedWeek, persistedMembership]) {
      assert.ok(persisted.entries.some((entry) => entry.key.startsWith(`${legacyContext.origin}|`)));
      assert.ok(persisted.entries.some((entry) => entry.key.startsWith(`${canonicalContext.origin}|`)));
    }
  });
});

test("cache Week v1 migra builds compatibles y converge en checkedAt más reciente", async () => {
  await withTempDir(async (userDataDir) => {
    const filePath = weekCachePath({ userDataDir });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      entries: [
        weekEntry("https://hsl.example|build-a:production:1|week:week-a"),
        weekEntry("https://hsl.example|build-b:preview:1|week:week-a", {
          checkedAt: "2026-08-02T00:00:00.000Z",
          publicState: "closed",
          reason: "week-closed",
        }),
        weekEntry("https://hsl.example|build-c:production:2|week:week-a", {
          checkedAt: "2026-08-03T00:00:00.000Z",
        }),
        weekEntry("https://other.example|build-a:production:1|week:week-a", {
          checkedAt: "2026-08-04T00:00:00.000Z",
        }),
      ],
    }), "utf8");

    const cache = createWeekCapabilityCache({ userDataDir });
    const initialized = await cache.initialize();
    assert.equal(initialized.schemaVersion, CACHE_SCHEMA_VERSION);
    assert.equal(initialized.migration.status, "persisted");
    assert.equal(initialized.migration.collisionCount, 1);
    assert.equal(initialized.invalidEntryCount, 1);
    assert.equal(cache.read(context, "week-a").publicState, "closed");
    assert.equal(cache.read({ ...context, origin: "https://other.example" }, "week-a").publicState, "active");
    const persisted = JSON.parse(await fsp.readFile(filePath, "utf8"));
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.entries.some((entry) => entry.key.includes("build-")), false);
  });
});

test("cache Membership v1 migra compatible, rechaza API incompatible y no cruza origins", async () => {
  await withTempDir(async (userDataDir) => {
    const filePath = membershipCachePath({ userDataDir });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      entries: [
        membershipEntry("https://hsl.example|build-a:production:1|user:user-a|season:season-a"),
        membershipEntry("https://hsl.example|build-b:production:2|user:user-b|season:season-a", { userId: "user-b" }),
        membershipEntry("https://other.example|build-a:production:1|user:user-a|season:season-a", { status: "not_member" }),
      ],
    }), "utf8");
    const cache = createMembershipCache({ userDataDir });
    await cache.initialize();
    assert.equal(cache.read(context, "user-a", "season-a").status, "member");
    assert.equal(cache.read(context, "user-b", "season-a"), null);
    assert.equal(cache.read({ ...context, origin: "https://other.example" }, "user-a", "season-a").status, "not_member");
  });
});

test("fallo de persistencia de migración no trunca legacy ni causa crash", async () => {
  await withTempDir(async (userDataDir) => {
    const filePath = weekCachePath({ userDataDir });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const legacy = {
      schemaVersion: 1,
      entries: [weekEntry("https://hsl.example|build-a:production:1|week:week-a")],
    };
    await fsp.writeFile(filePath, JSON.stringify(legacy), "utf8");
    const cache = createWeekCapabilityCache({ userDataDir }, {
      atomicWriteImpl: async () => { throw new Error("simulated-write-failure"); },
    });
    const initialized = await cache.initialize();
    assert.equal(initialized.migration.status, "write-failed");
    assert.equal(cache.read(context, "week-a").publicState, "active");
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath, "utf8")), legacy);
  });
});

test("cache corrupta se ignora y se repara en la siguiente verdad concluyente", async () => {
  await withTempDir(async (userDataDir) => {
    const config = { userDataDir };
    const filePath = weekCachePath(config);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, "{broken", "utf8");
    const cache = createWeekCapabilityCache(config);
    const initial = await cache.initialize();
    assert.equal(initial.corrupt, true);
    await cache.remember(context, {
      checkedAt: "2026-08-01T00:00:00.000Z",
      conclusive: true,
      publicState: "closed",
      reason: "week-closed",
      weekId: "week-a",
    });
    assert.equal(JSON.parse(await fsp.readFile(filePath, "utf8")).schemaVersion, 2);
  });
});

test("el reloj local nunca abre una semana de una temporada aun inactiva", async () => {
  await withTempDir(async (userDataDir) => {
    const cache = createWeekCapabilityCache({ userDataDir });
    await cache.initialize();
    await cache.remember(context, {
      checkedAt: "2026-08-01T00:00:00Z",
      conclusive: true,
      finalDeadlineAt: "2026-08-04T00:00:00Z",
      publicStartAt: "2026-08-02T00:00:00Z",
      publicState: "inactive",
      reason: "week-inactive",
      seasonId: "season-draft",
      seasonStatus: "draft",
      weekId: "week-draft",
    });
    assert.equal(cache.read(context, "week-draft", Date.parse("2026-08-03T00:00:00Z")).publicState, "inactive");
  });
});

test("raw CLOSED no invalida una autoridad canónica ACTIVE con calendario abierto", async () => {
  await withTempDir(async (userDataDir) => {
    const cache = createWeekCapabilityCache({ userDataDir });
    await cache.initialize();
    await cache.remember(context, {
      checkedAt: "2026-08-02T00:00:00Z",
      conclusive: true,
      derivedStatus: "active",
      finalDeadlineAt: "2026-08-03T00:00:00Z",
      publicStartAt: "2026-08-01T00:00:00Z",
      publicState: "active",
      rawStatus: "closed",
      reason: "week-active",
      seasonId: "season-a",
      seasonStatus: "active",
      weekId: "week-raw-closed",
    });
    const capability = cache.read(context, "week-raw-closed", Date.parse("2026-08-02T12:00:00Z"));
    assert.equal(capability.publicState, "active");
    assert.equal(capability.rawStatus, "closed");
  });
});
