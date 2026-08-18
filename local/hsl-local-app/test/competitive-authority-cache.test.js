const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createMembershipCache,
  createWeekCapabilityCache,
  membershipCachePath,
  weekCachePath,
} = require("../src/competitive-authority-cache");

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-authority-cache-"));
  try { return await run(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

const context = { deploymentKey: "build-a:production:1", origin: "https://hsl.example" };

test("week cache es durable, avanza con el reloj y no mezcla origin/deployment", async () => {
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
    assert.equal(cache.read({ ...context, deploymentKey: "build-b:production:1" }, "week-a"), null);
    assert.equal(cache.read({ ...context, origin: "https://other.example" }, "week-a"), null);

    const restarted = createWeekCapabilityCache(config);
    await restarted.initialize();
    assert.equal(restarted.read(context, "week-a", Date.parse("2026-08-02T12:00:00Z")).seasonId, "season-a");
    assert.equal(restarted.path, weekCachePath(config));
  });
});

test("membership cache conserva solo member/not_member y queda aislada por cuenta", async () => {
  await withTempDir(async (userDataDir) => {
    const config = { userDataDir };
    const cache = createMembershipCache(config);
    await cache.initialize();
    await cache.remember(context, { checkedAt: "2026-08-01T00:00:00Z", seasonId: "season-a", status: "member", userId: "user-a" });
    await cache.remember(context, { checkedAt: "2026-08-01T00:01:00Z", seasonId: "season-a", status: "unknown", userId: "user-a" });
    assert.equal(cache.read(context, "user-a", "season-a").status, "member");
    assert.equal(cache.read(context, "user-b", "season-a"), null);
    await cache.remember(context, { checkedAt: "2026-08-01T00:02:00Z", seasonId: "season-a", status: "not_member", userId: "user-a" });
    assert.equal(cache.read(context, "user-a", "season-a").status, "not_member");
    assert.equal(cache.path, membershipCachePath(config));
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
    await cache.remember(context, { conclusive: true, publicState: "closed", reason: "week-closed", weekId: "week-a" });
    assert.equal(JSON.parse(await fsp.readFile(filePath, "utf8")).schemaVersion, 1);
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
