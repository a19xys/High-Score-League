const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  applyScopedQueue,
  atomicWriteScopedMeta,
  buildPlayerPendingIndex,
  buildScopedSubmitConfig,
  derivePackKey,
  derivePlayerKey,
  ensureScopedQueue,
  resolveScopedQueue,
} = require("../src/scoped-queue");
const {
  PROTECTED_COMPETITION_MODE,
  authorityPathFor,
  readScopeAuthority,
} = require("../src/competition-scope-authority");
const {
  checkProtectedCompetitionEligibility,
  requiresProtectedCompetitionEvidence,
} = require("../src/competition-submission-eligibility");
const { deriveCompetitionPlayerBinding } = require("../src/competition-player-binding");
const { canonicalJsonBytes } = require("../src/run-input-integrity");

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
    eventsRejectedDirAbs: path.join(root, "staging", "rejected"),
    eventsSentDirAbs: path.join(root, "staging", "sent"),
    mame: { workingDir: path.join(root, "pack") },
    userDataDir: path.join(root, "userData"),
    webBaseUrl: "https://high-score-league.example",
    ...overrides,
  };
}

function protectedConfig(root, overrides = {}) {
  return baseConfig(root, {
    hslOrigin: "https://highscoreleague.com",
    remoteConfiguration: { source: "fixture" },
    webBaseUrl: "https://highscoreleague.com",
    pack: {
      packVersion: 2,
      gameId: "space-invaders",
      packId: "space-invaders-s1-w1-r2",
      packRoot: path.join(root, "pack"),
      rom: "invaders",
      webBaseUrl: "https://high-score-league.vercel.app",
      weekId: "week-1",
      contract: {
        version: 2,
        mame: { profiles: { competition: { integrity: { version: 1 } } } },
        capture: { automatic: { version: 1, strategy: "invaders-game-mode-final-v1" } },
      },
    },
    ...overrides,
  });
}

const session = {
  email: "player@example.com",
  hasSession: true,
  userId: "user-1",
};

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
    await fsp.access(scope.scopedRejectedDir);
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
  assert.equal(scoped.eventsRejectedDirAbs, scope.scopedRejectedDir);
  assert.equal(scoped.stagingEventsPendingDirAbs, config.eventsPendingDirAbs);
  assert.equal(scoped.eventsSource, "scoped-user-pack");
});

test("applyScopedQueue keeps legacy global queue out of v2 staging", () => {
  const config = baseConfig("C:/tmp", {
    eventQueueRole: "legacy-global",
    pack: {
      packVersion: 2,
      packId: "space-invaders-week-1",
      gameId: "space-invaders",
      rom: "invaders",
      weekId: "week-1",
    },
    requiresSharedMameRuntime: true,
  });
  const scope = resolveScopedQueue(config, {
    email: "player@example.com",
    hasSession: true,
    userId: "user-1",
  });
  const scoped = applyScopedQueue(config, scope);

  assert.equal(scoped.eventsPendingDirAbs, scope.scopedPendingDir);
  assert.equal(scoped.stagingEventsPendingDirAbs, null);
  assert.equal(scoped.legacyEventsPendingDirAbs, config.eventsPendingDirAbs);
  assert.equal(scoped.eventsSource, "scoped-user-pack");
});

test("protected scope authority survives restart and cannot downgrade with a changed pack", async () => {
  await withTempDir(async (dir) => {
    const config = protectedConfig(dir);
    const created = await ensureScopedQueue(config, session, { now: "2026-08-24T10:00:00.000Z" });
    const firstBytes = await fsp.readFile(authorityPathFor(created));
    assert.equal(created.competitionMode, PROTECTED_COMPETITION_MODE);

    const changedPack = protectedConfig(dir, {
      pack: {
        gameId: "space-invaders",
        packId: "space-invaders-s1-w1-r2",
        packRoot: path.join(dir, "moved-or-missing-pack"),
        rom: "invaders",
        webBaseUrl: "https://attacker.example",
        weekId: "week-1",
      },
    });
    const reopened = await ensureScopedQueue(changedPack, session, { now: "2026-08-24T11:00:00.000Z" });
    assert.equal(reopened.competitionMode, PROTECTED_COMPETITION_MODE);
    assert.deepEqual(await fsp.readFile(authorityPathFor(reopened)), firstBytes);

    const index = await buildPlayerPendingIndex({ userDataDir: config.userDataDir }, session);
    assert.equal(index.scopes[0].competitionMode, PROTECTED_COMPETITION_MODE);
    const reconstructed = buildScopedSubmitConfig({
      hslOrigin: "https://highscoreleague.com",
      remoteConfiguration: { source: "launcher" },
      userDataDir: config.userDataDir,
      webBaseUrl: "https://highscoreleague.com",
    }, index.scopes[0]);
    assert.equal(reconstructed.pack.contract, undefined);
    assert.equal(reconstructed.protectedCompetitionEvidenceRequired, true);
    assert.equal(requiresProtectedCompetitionEvidence(reconstructed), true);
    assert.equal(requiresProtectedCompetitionEvidence({ ...reconstructed, competitionMode: "legacy" }), true);
    assert.equal(reconstructed.webBaseUrl, "https://highscoreleague.com");
    assert.equal(reconstructed.pack.webBaseUrl, "https://attacker.example");
    assert.deepEqual(reconstructed.remoteConfiguration, { source: "launcher" });
    const contradictoryRecord = buildScopedSubmitConfig({
      userDataDir: config.userDataDir,
      webBaseUrl: "https://highscoreleague.com",
    }, { ...index.scopes[0], competitionMode: "legacy" });
    assert.equal(contradictoryRecord.competitionMode, PROTECTED_COMPETITION_MODE);
  });
});

test("scope authority mismatch is fail closed and never overwritten", async () => {
  await withTempDir(async (dir) => {
    const scope = await ensureScopedQueue(protectedConfig(dir), session, { now: "2026-08-24T10:00:00.000Z" });
    const filePath = authorityPathFor(scope);
    const value = JSON.parse(await fsp.readFile(filePath, "utf8"));
    value.weekId = "week-other";
    const contradictory = canonicalJsonBytes(value);
    await fsp.writeFile(filePath, contradictory);
    await assert.rejects(
      () => ensureScopedQueue(protectedConfig(dir), session, { now: "2026-08-24T11:00:00.000Z" }),
      /contradice|invalida/i,
    );
    assert.deepEqual(await fsp.readFile(filePath), contradictory);
  });
});

test("pre-fix scope backfills authority only from conclusive finalized receipts", async () => {
  await withTempDir(async (dir) => {
    const config = protectedConfig(dir);
    const scope = resolveScopedQueue(config, session);
    const meta = {
      schemaVersion: 1,
      createdAt: "2026-08-23T10:00:00.000Z",
      updatedAt: "2026-08-23T10:00:00.000Z",
      player: { email: session.email, playerKey: scope.playerKey, userId: session.userId },
      pack: {
        gameId: "space-invaders",
        packDir: path.join(dir, "removed-pack"),
        packId: "space-invaders-s1-w1-r2",
        packKey: scope.packKey,
        rom: "invaders",
        webBaseUrl: "https://high-score-league.vercel.app",
        weekId: "week-1",
      },
    };
    const receipt = {
      version: 1,
      runId: "run_prefixed_scope",
      weekId: "week-1",
      playerBinding: deriveCompetitionPlayerBinding(session.userId),
      packId: "space-invaders-s1-w1-r2",
      manifestSha256: "a".repeat(64),
      runInputManifestSha256: "b".repeat(64),
      captureClientVersion: "0.3.0",
      provenance: { artifactSha256: "c".repeat(64), artifactSizeBytes: 1, competitionManifestSha256: "a".repeat(64), mode: "remote_verified" },
      status: "clean",
      violations: [],
      outputs: [],
      finalizedAt: "2026-08-23T10:30:00.000Z",
    };
    await Promise.all([
      fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
      fsp.mkdir(path.join(scope.scopedQueueRoot, "competition", "finalized"), { recursive: true }),
    ]);
    await fsp.writeFile(path.join(scope.scopedQueueRoot, "meta.json"), JSON.stringify(meta));
    await fsp.writeFile(
      path.join(scope.scopedQueueRoot, "competition", "finalized", `${receipt.runId}.json`),
      canonicalJsonBytes(receipt),
    );
    const index = await buildPlayerPendingIndex({ userDataDir: config.userDataDir }, session);
    assert.equal(index.scopes[0].competitionMode, PROTECTED_COMPETITION_MODE);
    assert.equal(index.scopes[0].scopeAuthority.mode, PROTECTED_COMPETITION_MODE);
    assert.equal((await readScopeAuthority(scope, {
      playerKey: scope.playerKey,
      packKey: scope.packKey,
      packId: meta.pack.packId,
      weekId: meta.pack.weekId,
    })).status, "valid");
  });
});

test("ambiguous competition subtree is skipped as protected-invalid and preserves pending", async () => {
  await withTempDir(async (dir) => {
    const config = protectedConfig(dir);
    const legacyLike = { ...config, pack: { ...config.pack, contract: undefined, packVersion: undefined } };
    const scope = resolveScopedQueue(legacyLike, session);
    const meta = {
      schemaVersion: 1,
      player: { playerKey: scope.playerKey, userId: session.userId },
      pack: {
        gameId: "space-invaders", packId: config.pack.packId, packKey: scope.packKey,
        rom: "invaders", webBaseUrl: "https://attacker.example", weekId: "week-1",
      },
    };
    const pendingPath = path.join(scope.scopedPendingDir, "preserved.json");
    await Promise.all([
      fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
      fsp.mkdir(path.join(scope.scopedQueueRoot, "competition"), { recursive: true }),
    ]);
    await fsp.writeFile(path.join(scope.scopedQueueRoot, "meta.json"), JSON.stringify(meta));
    await fsp.writeFile(pendingPath, "{}");
    const index = await buildPlayerPendingIndex({ userDataDir: config.userDataDir }, session);
    assert.equal(index.records.length, 0);
    assert.ok(index.skipped.some((item) => item.reason === "missing-finalized-receipt" && item.count === 1));
    await fsp.access(pendingPath);
  });
});

test("corrupt scope authority is never treated as legacy and preserves pending", async () => {
  await withTempDir(async (dir) => {
    const config = protectedConfig(dir);
    const scope = await ensureScopedQueue(config, session, { now: "2026-08-24T10:00:00.000Z" });
    const pendingPath = path.join(scope.scopedPendingDir, "preserved.json");
    await fsp.writeFile(pendingPath, "{}");
    await fsp.writeFile(authorityPathFor(scope), "{corrupt");
    const index = await buildPlayerPendingIndex({ userDataDir: config.userDataDir }, session);
    assert.equal(index.records.length, 0);
    assert.ok(index.skipped.some((item) => item.reason === "invalid-scope-authority" && item.count === 1));
    await fsp.access(pendingPath);
  });
});

test("meta update is atomic across a crash before rename", async () => {
  await withTempDir(async (dir) => {
    const config = baseConfig(dir);
    const scope = await ensureScopedQueue(config, session, { now: "2026-08-24T10:00:00.000Z" });
    const original = await fsp.readFile(scope.metaPath);
    await assert.rejects(
      () => ensureScopedQueue(config, session, {
        now: "2026-08-24T11:00:00.000Z",
        beforeMetaRename: async () => { throw new Error("simulated-meta-crash"); },
      }),
      /simulated-meta-crash/,
    );
    assert.deepEqual(await fsp.readFile(scope.metaPath), original);
    assert.doesNotThrow(() => JSON.parse(original.toString("utf8")));

    const freshPath = path.join(dir, "fresh", "meta.json");
    await assert.rejects(
      () => atomicWriteScopedMeta(freshPath, { schemaVersion: 1 }, {
        beforeMetaRename: async () => { throw new Error("simulated-create-crash"); },
      }),
      /simulated-create-crash/,
    );
    await assert.rejects(() => fsp.access(freshPath));
    assert.deepEqual((await fsp.readdir(path.dirname(freshPath))).filter((name) => name.includes(".tmp-")), []);
  });
});

test("corrupt meta is skipped without deleting pending and repaired atomically by full context", async () => {
  await withTempDir(async (dir) => {
    const config = baseConfig(dir);
    const scope = await ensureScopedQueue(config, session, { now: "2026-08-24T10:00:00.000Z" });
    const pendingPath = path.join(scope.scopedPendingDir, "preserved.json");
    await fsp.writeFile(pendingPath, "{}");
    await fsp.writeFile(scope.metaPath, "{corrupt");
    const skipped = await buildPlayerPendingIndex({ userDataDir: config.userDataDir }, session);
    assert.ok(skipped.skipped.some((item) => item.reason === "invalid-meta"));
    await fsp.access(pendingPath);

    const repaired = await ensureScopedQueue(config, session, { now: "2026-08-24T11:00:00.000Z" });
    assert.equal(JSON.parse(await fsp.readFile(repaired.metaPath, "utf8")).schemaVersion, 1);
    await fsp.access(pendingPath);
  });
});

test("legacy queue remains legacy after restart", async () => {
  await withTempDir(async (dir) => {
    const config = baseConfig(dir);
    await ensureScopedQueue(config, session, { now: "2026-08-24T10:00:00.000Z" });
    const index = await buildPlayerPendingIndex({ userDataDir: config.userDataDir }, session);
    assert.equal(index.scopes[0].competitionMode, "legacy");
    const reconstructed = buildScopedSubmitConfig({ userDataDir: config.userDataDir, webBaseUrl: "https://highscoreleague.com" }, index.scopes[0]);
    assert.equal(requiresProtectedCompetitionEvidence(reconstructed), false);
    assert.deepEqual(
      await checkProtectedCompetitionEligibility(reconstructed, { schemaVersion: 1 }, path.join(dir, "unused.json")),
      { eligible: true, kind: "legacy" },
    );
  });
});
