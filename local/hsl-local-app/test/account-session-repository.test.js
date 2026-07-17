const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  canonicalSessionPath,
  createAccountSessionRepository,
  migrationJournalPath,
  sessionLockPath,
} = require("../src/account-session-repository");
const { readKnownAccounts, rememberAccount, removeKnownAccount, rememberSessionAccount } = require("../src/account-store");
const { acquireFileLock } = require("../src/file-lock");
const { atomicWriteJson, readStoredSession, writeStoredSession } = require("../src/secure-session-storage");

async function withTempDir(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-canonical-session-test-"));
  try { return await fn(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

function config(root) {
  return {
    sessionFileAbs: path.join(root, "userData", "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    userDataDir: path.join(root, "userData"),
  };
}

function stored(userId = "user-1", suffix = "one", expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  return {
    schemaVersion: 1,
    session: {
      access_token: `access-${suffix}`,
      expires_at: expiresAt,
      refresh_token: `refresh-${suffix}`,
      token_type: "bearer",
    },
    supabaseUrl: "https://example.supabase.co",
    user: { email: `${suffix}@example.com`, id: userId },
  };
}

function repository(cfg, overrides = {}) {
  return createAccountSessionRepository({
    config: cfg,
    isExpiringSoon: (value) => Number(value?.session?.expires_at) <= Math.floor(Date.now() / 1000) + 60,
    refreshProvider: async ({ storedSession }) => ({
      ...storedSession,
      session: {
        ...storedSession.session,
        access_token: "access-refreshed",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "refresh-refreshed",
      },
    }),
    ...overrides,
  });
}

test("login persists one canonical session and a monotonic active pointer", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const repo = repository(cfg);
    const first = await repo.saveLogin(stored());
    const second = await repo.saveLogin(stored("user-1", "two"));
    const persisted = await repo.read("user-1");
    const accounts = await readKnownAccounts(cfg);
    assert.equal(first.sessionRevision, 1);
    assert.equal(second.sessionRevision, 2);
    assert.equal(persisted.sessionRevision, 2);
    assert.equal(persisted.storedSession.session.refresh_token, "refresh-two");
    assert.equal(accounts.lastActiveUserId, "user-1");
    await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
  });
});

test("same-user resolves share one refresh and different users remain independent", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    let calls = 0;
    let release;
    let markStarted;
    const refreshStarted = new Promise((resolve) => { markStarted = resolve; });
    const repo = repository(cfg, {
      refreshProvider: async ({ storedSession }) => {
        calls += 1;
        markStarted();
        await new Promise((resolve) => { release = resolve; });
        return { ...storedSession, session: { ...storedSession.session, expires_at: Math.floor(Date.now() / 1000) + 3600 } };
      },
    });
    await repo.saveLogin(stored("user-1", "one", 1));
    const a = repo.resolve("user-1", { connected: true });
    const b = repo.resolve("user-1", { connected: true });
    await refreshStarted;
    assert.equal(calls, 1);
    release();
    const [left, right] = await Promise.all([a, b]);
    assert.equal(left.sessionRevision, 2);
    assert.equal(right.sessionRevision, 2);
    assert.equal(repo.getDiagnosticsSnapshot().sharedRefreshCount, 1);
  });
});

test("different users refresh concurrently without a global lock", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const waiting = new Set();
    let releaseAll;
    const release = new Promise((resolve) => { releaseAll = resolve; });
    let bothStarted;
    const started = new Promise((resolve) => { bothStarted = resolve; });
    const repo = repository(cfg, {
      refreshProvider: async ({ userId, storedSession }) => {
        waiting.add(userId);
        if (waiting.size === 2) bothStarted();
        await release;
        return { ...storedSession, session: { ...storedSession.session, expires_at: Math.floor(Date.now() / 1000) + 3600 } };
      },
    });
    await repo.saveLogin(stored("user-a", "a", 1), { setActive: false });
    await repo.saveLogin(stored("user-b", "b", 1), { setActive: false });
    const a = repo.resolve("user-a", { connected: true });
    const b = repo.resolve("user-b", { connected: true });
    await started;
    assert.deepEqual(waiting, new Set(["user-a", "user-b"]));
    releaseAll();
    await Promise.all([a, b]);
  });
});

test("login cancels an old refresh and stale tokens cannot overwrite it", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    let started;
    let finish;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const repo = repository(cfg, {
      refreshProvider: async () => {
        started();
        await new Promise((resolve) => { finish = resolve; });
        return stored("user-1", "stale", Math.floor(Date.now() / 1000) + 3600);
      },
    });
    await repo.saveLogin(stored("user-1", "old", 1));
    const refresh = repo.resolve("user-1", { connected: true });
    await startedPromise;
    const login = repo.saveLogin(stored("user-1", "new"));
    finish();
    const [refreshResult, loginResult] = await Promise.all([refresh, login]);
    const final = await repo.read("user-1");
    assert.equal(refreshResult.stale, true);
    assert.equal(loginResult.sessionRevision, 2);
    assert.equal(final.storedSession.session.refresh_token, "refresh-new");
    assert.equal(repo.getDiagnosticsSnapshot().staleWriteRejectedCount, 1);
  });
});

test("temporary refresh failures and lock timeout preserve the canonical session", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const repo = repository(cfg, {
      lockTimeoutMs: 30,
      refreshProvider: async () => { throw Object.assign(new Error("503"), { sessionStatus: "temporary-failure" }); },
    });
    await repo.saveLogin(stored("user-1", "old", 1));
    const deferred = await repo.resolve("user-1", { connected: true });
    assert.equal(deferred.status, "deferred");
    assert.equal((await repo.read("user-1")).sessionRevision, 1);
    const lock = await acquireFileLock(sessionLockPath(cfg, "user-1"), { purpose: "test" });
    try {
      const locked = await repo.resolve("user-1", { connected: true, force: true, timeoutMs: 20 });
      assert.equal(locked.status, "lock-timeout");
      assert.equal(locked.reason, "lock-timeout");
    } finally {
      await lock.release();
    }
    assert.equal((await repo.read("user-1")).storedSession.session.refresh_token, "refresh-old");
  });
});

test("timeout, 429, 5xx, DNS, TLS and lifecycle cancellation are all deferred", async () => {
  const failures = [
    Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("rate limited"), { status: 429 }),
    Object.assign(new Error("unavailable"), { status: 503 }),
    Object.assign(new Error("dns"), { code: "ENOTFOUND" }),
    Object.assign(new Error("tls"), { code: "CERT_HAS_EXPIRED" }),
    Object.assign(new Error("cancelled"), { name: "AbortError" }),
  ];
  for (const [index, failure] of failures.entries()) {
    await withTempDir(async (root) => {
      const cfg = config(root);
      const repo = repository(cfg, { refreshProvider: async () => { throw failure; } });
      await repo.saveLogin(stored("user-1", `old-${index}`, 1));
      const result = await repo.resolve("user-1", { connected: true });
      assert.equal(result.status, "deferred");
      assert.equal(result.storedSession.session.refresh_token, `refresh-old-${index}`);
      assert.equal((await repo.read("user-1")).sessionRevision, 1);
    });
  }
});

test("conclusive revocation removes secrets but preserves account metadata", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const repo = repository(cfg, {
      refreshProvider: async () => { throw Object.assign(new Error("revoked"), { code: "refresh-token-rejected", sessionStatus: "revoked" }); },
    });
    await repo.saveLogin(stored("user-1", "old", 1));
    const result = await repo.resolve("user-1", { connected: true });
    assert.equal(result.status, "revoked");
    assert.equal((await repo.read("user-1")).ok, false);
    const accounts = await readKnownAccounts(cfg);
    assert.equal(accounts.accounts[0].requiresLogin, true);
  });
});

test("a refreshed session with the wrong identity is conclusively revoked", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const repo = repository(cfg, { refreshProvider: async () => stored("other-user", "wrong") });
    await repo.saveLogin(stored("user-1", "old", 1));
    assert.equal((await repo.resolve("user-1", { connected: true })).status, "revoked");
    assert.equal((await repo.read("user-1")).status, "revoked");
    assert.equal((await readKnownAccounts(cfg)).accounts[0].requiresLogin, true);
  });
});

test("write failures before or after rename restore the last verified revision", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await repository(cfg).saveLogin(stored("user-1", "original"));
    const beforeRename = repository(cfg, {
      atomicWriteImpl: async () => { throw new Error("before rename"); },
    });
    await assert.rejects(() => beforeRename.saveLogin(stored("user-1", "before")));
    assert.equal((await repository(cfg).read("user-1")).storedSession.session.refresh_token, "refresh-original");
    const afterRename = repository(cfg, {
      atomicWriteImpl: async (file, value) => {
        await atomicWriteJson(file, value);
        throw new Error("after rename");
      },
    });
    await assert.rejects(() => afterRename.saveLogin(stored("user-1", "after")));
    const final = await repository(cfg).read("user-1");
    assert.equal(final.sessionRevision, 1);
    assert.equal(final.storedSession.session.refresh_token, "refresh-original");
  });
});

test("known accounts serialize overlapping logins and stale touches cannot resurrect removal", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await Promise.all([
      rememberAccount(cfg, { email: "a@example.com", userId: "user-a" }),
      rememberAccount(cfg, { email: "b@example.com", userId: "user-b" }),
    ]);
    assert.deepEqual(new Set((await readKnownAccounts(cfg)).accounts.map((item) => item.userId)), new Set(["user-a", "user-b"]));
    await removeKnownAccount(cfg, "user-a", { deleteSession: false });
    await rememberSessionAccount(cfg, { email: "a@example.com", hasSession: true, userId: "user-a" }, { touch: true });
    assert.equal((await readKnownAccounts(cfg)).accounts.some((item) => item.userId === "user-a"), false);
  });
});

test("legacy active session migrates once, writes a token-free journal and removes session.json", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "legacy"), { expectedUserId: "user-1" });
    const repo = repository(cfg);
    assert.equal((await repo.migrateLegacy()).status, "completed");
    const revision = (await repo.read("user-1")).sessionRevision;
    assert.equal((await repo.migrateLegacy()).status, "completed");
    assert.equal((await repo.read("user-1")).sessionRevision, revision);
    await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
    const journal = await fsp.readFile(migrationJournalPath(cfg), "utf8");
    assert.equal(journal.includes("access-legacy"), false);
    assert.equal(journal.includes("refresh-legacy"), false);
  });
});

test("legacy characterization records duplicated login tokens and one-sided refresh divergence", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const rememberedPath = canonicalSessionPath(cfg, "user-1");
    await rememberAccount(cfg, { email: "one@example.com", userId: "user-1" });
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "login", 10), { expectedUserId: "user-1", savedAt: "2026-07-16T00:00:00.000Z" });
    await writeStoredSession(rememberedPath, stored("user-1", "login", 10), { expectedUserId: "user-1", savedAt: "2026-07-16T00:00:00.000Z" });
    assert.equal((await readStoredSession(cfg.sessionFileAbs)).storedSession.session.refresh_token, (await readStoredSession(rememberedPath)).storedSession.session.refresh_token);
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "active-refresh", 20), { expectedRevision: 1, expectedUserId: "user-1", savedAt: "2026-07-17T00:00:00.000Z" });
    assert.notEqual((await readStoredSession(cfg.sessionFileAbs)).storedSession.session.refresh_token, (await readStoredSession(rememberedPath)).storedSession.session.refresh_token);
    assert.equal((await repository(cfg).migrateLegacy()).status, "completed");
    assert.equal((await repository(cfg).read("user-1")).storedSession.session.refresh_token, "refresh-active-refresh");
  });
});

test("login, refresh and account pointer survive repository restarts without token copies", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const first = repository(cfg);
    await first.saveLogin(stored("user-a", "a", 1), { setActive: false });
    await first.saveLogin(stored("user-b", "b"));
    const restarted = repository(cfg);
    await restarted.setActive("user-a");
    const refreshed = await restarted.resolve("user-a", { connected: true });
    assert.equal(refreshed.sessionRevision, 2);
    const afterSecondRestart = repository(cfg);
    assert.equal((await afterSecondRestart.read("user-a")).sessionRevision, 2);
    assert.equal((await afterSecondRestart.read("user-b")).storedSession.session.refresh_token, "refresh-b");
    assert.equal((await readKnownAccounts(cfg)).lastActiveUserId, "user-a");
    await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
  });
});

test("ambiguous divergent legacy copies require recovery and preserve both sources", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const savedAt = "2026-07-17T00:00:00.000Z";
    await rememberAccount(cfg, { email: "one@example.com", userId: "user-1" });
    await writeStoredSession(canonicalSessionPath(cfg, "user-1"), stored("user-1", "remembered", 100), { expectedUserId: "user-1", savedAt });
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "active", 100), { expectedUserId: "user-1", savedAt });
    const repo = repository(cfg);
    const result = await repo.migrateLegacy();
    assert.equal(result.status, "recovery-required");
    assert.equal((await repo.read("user-1")).status, "recovery-required");
    await fsp.access(cfg.sessionFileAbs);
    await fsp.access(canonicalSessionPath(cfg, "user-1"));
  });
});

test("an explicit login resolves an ambiguous migration without merging either legacy token set", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const savedAt = "2026-07-17T00:00:00.000Z";
    await rememberAccount(cfg, { email: "one@example.com", userId: "user-1" });
    await writeStoredSession(canonicalSessionPath(cfg, "user-1"), stored("user-1", "remembered", 100), { expectedUserId: "user-1", savedAt });
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "active", 100), { expectedUserId: "user-1", savedAt });
    const repo = repository(cfg);
    assert.equal((await repo.migrateLegacy()).status, "recovery-required");
    const login = await repo.saveLogin(stored("user-1", "fresh"));
    assert.equal(login.sessionRevision, 2);
    assert.equal((await repo.read("user-1")).storedSession.session.refresh_token, "refresh-fresh");
    await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
  });
});

test("migration deterministically selects the more recent complete legacy copy without merging tokens", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await rememberAccount(cfg, { email: "one@example.com", userId: "user-1" });
    await writeStoredSession(canonicalSessionPath(cfg, "user-1"), stored("user-1", "remembered", 100), {
      expectedUserId: "user-1",
      savedAt: "2026-07-16T00:00:00.000Z",
    });
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "active", 90), {
      expectedUserId: "user-1",
      savedAt: "2026-07-17T00:00:00.000Z",
    });
    const repo = repository(cfg);
    assert.equal((await repo.migrateLegacy()).status, "completed");
    const selected = (await repo.read("user-1")).storedSession;
    assert.equal(selected.session.access_token, "access-active");
    assert.equal(selected.session.refresh_token, "refresh-active");
  });
});

test("corrupt migration journal and corrupt canonical payload require recovery without overwrite", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await fsp.mkdir(path.dirname(migrationJournalPath(cfg)), { recursive: true });
    await fsp.writeFile(migrationJournalPath(cfg), "{broken", "utf8");
    await fsp.mkdir(path.dirname(canonicalSessionPath(cfg, "user-1")), { recursive: true });
    await fsp.writeFile(canonicalSessionPath(cfg, "user-1"), "{broken", "utf8");
    const repo = repository(cfg);
    assert.equal((await repo.migrateLegacy()).status, "recovery-required");
    assert.equal((await repo.read("user-1")).status, "corrupt");
    assert.equal(await fsp.readFile(canonicalSessionPath(cfg, "user-1"), "utf8"), "{broken");
  });
});

test("a corrupt unowned active legacy source is preserved for recovery", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await fsp.mkdir(path.dirname(cfg.sessionFileAbs), { recursive: true });
    await fsp.writeFile(cfg.sessionFileAbs, "{broken", "utf8");
    assert.equal((await repository(cfg).migrateLegacy()).status, "recovery-required");
    assert.equal(await fsp.readFile(cfg.sessionFileAbs, "utf8"), "{broken");
  });
});

test("legacy cleanup failure leaves a resumable verified canonical session", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "legacy"), { expectedUserId: "user-1" });
    const first = repository(cfg);
    await assert.rejects(() => first.migrateLegacy({ unlinkLegacyImpl: async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); } }));
    assert.equal((await first.read("user-1")).sessionRevision, 1);
    await fsp.access(cfg.sessionFileAbs);
    const restarted = repository(cfg);
    assert.equal((await restarted.migrateLegacy()).status, "completed");
    assert.equal((await restarted.read("user-1")).sessionRevision, 1);
    await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
  });
});

test("migration resumes after deterministic interruptions without advancing the canonical revision twice", async () => {
  for (const failAfter of ["sources-read", "canonical-written", "canonical-verified", "legacy-cleaned"]) {
    await withTempDir(async (root) => {
      const cfg = config(root);
      await writeStoredSession(cfg.sessionFileAbs, stored("user-1", failAfter), { expectedUserId: "user-1" });
      const first = repository(cfg);
      await assert.rejects(() => first.migrateLegacy({ failAfter }), (error) => error.code === "MIGRATION_INTERRUPTED");
      const revisionAfterInterruption = (await first.read("user-1")).sessionRevision || 0;
      const restarted = repository(cfg);
      assert.equal((await restarted.migrateLegacy()).status, "completed");
      const final = await restarted.read("user-1");
      assert.equal(final.sessionRevision, 1);
      assert.ok(revisionAfterInterruption === 0 || revisionAfterInterruption === 1);
      await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
    });
  }
});

function spawnChild(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exit ${code}`)));
  });
}

test("two processes serialize one refresh token and the second rereads the new revision", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await repository(cfg).saveLogin(stored("user-1", "old", 1));
    const configPath = path.join(root, "config.json");
    const markerPath = path.join(root, "refreshes.txt");
    const firstResult = path.join(root, "first.json");
    const secondResult = path.join(root, "second.json");
    await fsp.writeFile(configPath, JSON.stringify(cfg), "utf8");
    const childScript = path.join(__dirname, "..", "test-support", "account-session-child.cjs");
    await Promise.all([
      spawnChild(childScript, [configPath, markerPath, firstResult, "user-1"]),
      spawnChild(childScript, [configPath, markerPath, secondResult, "user-1"]),
    ]);
    const markers = (await fsp.readFile(markerPath, "utf8")).trim().split(/\r?\n/);
    const results = await Promise.all([firstResult, secondResult].map(async (file) => JSON.parse(await fsp.readFile(file, "utf8"))));
    assert.equal(markers.length, 1);
    assert.deepEqual(results.map((item) => item.revision), [2, 2]);
  });
});

test("two processes mutate known accounts without lost updates", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const configPath = path.join(root, "config.json");
    await fsp.writeFile(configPath, JSON.stringify(cfg), "utf8");
    const childScript = path.join(__dirname, "..", "test-support", "known-account-child.cjs");
    await Promise.all([
      spawnChild(childScript, [configPath, "user-a"]),
      spawnChild(childScript, [configPath, "user-b"]),
    ]);
    const store = await readKnownAccounts(cfg);
    assert.deepEqual(new Set(store.accounts.map((account) => account.userId)), new Set(["user-a", "user-b"]));
    assert.equal(store.revision, 2);
    JSON.parse(await fsp.readFile(store.filePath, "utf8"));
  });
});

test("two processes logging into the same account allocate distinct monotonic revisions", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const configPath = path.join(root, "config.json");
    const firstResult = path.join(root, "login-first.json");
    const secondResult = path.join(root, "login-second.json");
    await fsp.writeFile(configPath, JSON.stringify(cfg), "utf8");
    const childScript = path.join(__dirname, "..", "test-support", "session-login-child.cjs");
    await Promise.all([
      spawnChild(childScript, [configPath, firstResult, "first"]),
      spawnChild(childScript, [configPath, secondResult, "second"]),
    ]);
    const revisions = await Promise.all([firstResult, secondResult].map(async (file) => JSON.parse(await fsp.readFile(file, "utf8")).revision));
    assert.deepEqual(revisions.sort((left, right) => left - right), [1, 2]);
    const final = await repository(cfg).read("user-1");
    assert.equal(final.sessionRevision, 2);
    assert.ok(["refresh-first", "refresh-second"].includes(final.storedSession.session.refresh_token));
  });
});

test("two processes serialize the global canonical migration", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "legacy"), { expectedUserId: "user-1" });
    const configPath = path.join(root, "migration-config.json");
    const firstResult = path.join(root, "migration-first.json");
    const secondResult = path.join(root, "migration-second.json");
    await fsp.writeFile(configPath, JSON.stringify(cfg), "utf8");
    const childScript = path.join(__dirname, "..", "test-support", "session-migration-child.cjs");
    await Promise.all([
      spawnChild(childScript, [configPath, firstResult]),
      spawnChild(childScript, [configPath, secondResult]),
    ]);
    const statuses = await Promise.all([firstResult, secondResult].map(async (file) => JSON.parse(await fsp.readFile(file, "utf8")).status));
    assert.deepEqual(statuses, ["completed", "completed"]);
    assert.equal((await repository(cfg).read("user-1")).sessionRevision, 1);
    await assert.rejects(() => fsp.access(cfg.sessionFileAbs));
  });
});

test("lock files contain no identity or tokens and are released", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const file = sessionLockPath(cfg, "private-user-id");
    const lock = await acquireFileLock(file, { purpose: "test", userHash: "user_deadbeef" });
    const raw = await fsp.readFile(file, "utf8");
    assert.equal(raw.includes("private-user-id"), false);
    assert.equal(/access|refresh_token|email/.test(raw), false);
    await lock.release();
    await assert.rejects(() => fsp.access(file));
  });
});

test("stale lock recovery removes a dead owner but never a live owner", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const file = sessionLockPath(cfg, "user-1");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify({ createdAt: "2000-01-01T00:00:00.000Z", nonce: "dead", pid: 2147483647 }), "utf8");
    const recovered = await acquireFileLock(file, { purpose: "recovery-test", staleAfterMs: 1, timeoutMs: 50 });
    await recovered.release();
    await fsp.writeFile(file, JSON.stringify({ createdAt: "2000-01-01T00:00:00.000Z", nonce: "live", pid: process.pid }), "utf8");
    await assert.rejects(
      () => acquireFileLock(file, { purpose: "live-test", staleAfterMs: 1, timeoutMs: 20 }),
      (error) => error.code === "SESSION_LOCK_TIMEOUT",
    );
  });
});
