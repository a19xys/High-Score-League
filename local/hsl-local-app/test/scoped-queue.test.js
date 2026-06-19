const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  applyScopedQueue,
  derivePackKey,
  derivePlayerKey,
  ensureScopedQueue,
  resolveScopedQueue,
} = require("../src/scoped-queue");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-scoped-queue-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function baseConfig(root, overrides = {}) {
  return {
    defaultWeekId: "week-1",
    eventsFailedDirAbs: path.join(root, "staging", "failed"),
    eventsPendingDirAbs: path.join(root, "staging", "pending"),
    eventsSentDirAbs: path.join(root, "staging", "sent"),
    mame: { workingDir: path.join(root, "pack") },
    userDataDir: path.join(root, "userData"),
    webBaseUrl: "https://high-score-league.example",
    ...overrides,
  };
}

test("derivePlayerKey uses user id before email", () => {
  const key = derivePlayerKey({
    email: "player@example.com",
    hasSession: true,
    userId: "User 123",
  });

  assert.equal(key, "user_user-123");
});

test("derivePlayerKey hashes email when user id is missing", () => {
  const a = derivePlayerKey({ email: "player@example.com", hasSession: true });
  const b = derivePlayerKey({ email: "other@example.com", hasSession: true });

  assert.match(a, /^email_[a-f0-9]{16}$/);
  assert.notEqual(a, b);
});

test("derivePlayerKey returns null without connected session", () => {
  assert.equal(derivePlayerKey({ hasSession: false }), null);
});

test("derivePackKey uses packId when present", () => {
  const key = derivePackKey({
    pack: {
      gameId: "space-invaders",
      packId: "Space Invaders Week 1",
      rom: "invaders",
      weekId: "week-1",
    },
  });

  assert.equal(key, "pack_space-invaders-week-1");
});

test("derivePackKey falls back to game rom and week", () => {
  const key = derivePackKey({
    pack: {
      gameId: "space-invaders",
      rom: "invaders",
      weekId: "week-2",
    },
  });

  assert.equal(key, "pack_space-invaders-invaders-week-2");
});

test("ensureScopedQueue creates directories and meta without tokens", async () => {
  await withTempDir(async (dir) => {
    const config = baseConfig(dir, {
      pack: {
        gameId: "space-invaders",
        packId: "space-invaders-week-1",
        packRoot: path.join(dir, "pack"),
        rom: "invaders",
        weekId: "week-1",
      },
    });
    const session = {
      email: "player@example.com",
      hasSession: true,
      userId: "user-1",
    };

    const scope = await ensureScopedQueue(config, session, {
      now: "2026-06-19T00:00:00.000Z",
    });
    const metaRaw = await fsp.readFile(scope.metaPath, "utf8");

    await fsp.access(scope.scopedPendingDir);
    await fsp.access(scope.scopedFailedDir);
    await fsp.access(scope.scopedSentDir);
    assert.equal(scope.playerKey, "user_user-1");
    assert.equal(scope.packKey, "pack_space-invaders-week-1");
    assert.equal(metaRaw.includes("access_token"), false);
    assert.equal(metaRaw.includes("refresh_token"), false);
    assert.equal(JSON.parse(metaRaw).player.email, "player@example.com");
  });
});

test("scoped queue separates accounts and packs", () => {
  const configA = baseConfig("C:/tmp", {
    pack: { gameId: "space-invaders", rom: "invaders", weekId: "week-1" },
  });
  const configB = baseConfig("C:/tmp", {
    pack: { gameId: "space-invaders", rom: "invaders", weekId: "week-2" },
  });
  const playerA = { email: "a@example.com", hasSession: true, userId: "user-a" };
  const playerB = { email: "b@example.com", hasSession: true, userId: "user-b" };

  assert.notEqual(resolveScopedQueue(configA, playerA).scopedQueueRoot, resolveScopedQueue(configA, playerB).scopedQueueRoot);
  assert.notEqual(resolveScopedQueue(configA, playerA).scopedQueueRoot, resolveScopedQueue(configB, playerA).scopedQueueRoot);
});

test("applyScopedQueue keeps staging paths and switches active event dirs", () => {
  const config = baseConfig("C:/tmp");
  const scope = resolveScopedQueue(config, {
    email: "player@example.com",
    hasSession: true,
    userId: "user-1",
  });
  const scoped = applyScopedQueue(config, scope);

  assert.equal(scoped.eventsPendingDirAbs, scope.scopedPendingDir);
  assert.equal(scoped.stagingEventsPendingDirAbs, config.eventsPendingDirAbs);
  assert.equal(scoped.eventsSource, "scoped-user-pack");
});
