const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  canonicalSessionPath,
  createAccountSessionRepository,
  migrationJournalPath,
} = require("../src/account-session-repository");
const {
  getKnownAccountsPath,
  readKnownAccounts,
  rememberAccount,
} = require("../src/account-store");
const {
  getAccountSessionRepository,
  getAuthState,
  resolveCanonicalSessionResult,
} = require("../src/auth");
const { acquireFileLock } = require("../src/file-lock");
const {
  configureSessionProtection,
  writeStoredSession,
} = require("../src/secure-session-storage");

async function withTempDir(operation) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-session-stabilization-"));
  try {
    return await operation(root);
  } finally {
    await fsp.rm(root, { force: true, recursive: true });
  }
}

function config(root, overrides = {}) {
  const userDataDir = path.join(root, "userData");
  return {
    sessionFileAbs: path.join(userDataDir, "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://project.supabase.co",
    userDataDir,
    ...overrides,
  };
}

function stored(userId = "user-1", suffix = "one", expiresAt = Math.floor(Date.now() / 1000) + 3600, supabaseUrl = "https://project.supabase.co") {
  return {
    schemaVersion: 1,
    session: {
      access_token: `access-${suffix}`,
      expires_at: expiresAt,
      refresh_token: `refresh-${suffix}`,
      token_type: "bearer",
    },
    supabaseUrl,
    user: { email: `${suffix}@example.com`, id: userId },
  };
}

function repository(cfg, overrides = {}) {
  return createAccountSessionRepository({
    config: cfg,
    isExpiringSoon: (value) => Number(value?.session?.expires_at) <= Math.floor(Date.now() / 1000) + 60,
    refreshProvider: async ({ storedSession }) => stored(storedSession.user.id, "refreshed"),
    ...overrides,
  });
}

test("a real successful refresh has an exhaustive result and getAuthState accepts it", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const repo = repository(cfg);
    await repo.saveLogin(stored("user-1", "old", 1));

    const refreshed = await repo.resolve("user-1", { connected: true });
    assert.equal(refreshed.status, "refreshed");
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.hasLocalSession, true);
    assert.equal(refreshed.remoteUsable, true);
    assert.equal(refreshed.requiresLogin, false);

    const state = await getAuthState(cfg, { repository: repo });
    assert.equal(state.status, "ok");
    assert.equal(state.hasSession, true);
  });
});

test("a temporary refresh failure preserves an expired session without making it remotely usable", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const repo = repository(cfg, {
      refreshProvider: async () => {
        throw Object.assign(new Error("temporary"), { sessionStatus: "temporary-failure", status: 503 });
      },
    });
    await repo.saveLogin(stored("user-1", "expired", 1));

    const result = await repo.resolve("user-1", { connected: true });
    assert.equal(result.status, "deferred");
    assert.equal(result.hasLocalSession, true);
    assert.equal(result.remoteUsable, false);
    assert.equal(result.requiresLogin, false);
    assert.equal(result.shouldRetry, true);
  });
});

test("session revisions remain monotonic across revoke, logout/remove, restart and relogin", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const first = repository(cfg);
    assert.equal((await first.saveLogin(stored("user-1", "login"))).sessionRevision, 1);
    assert.equal((await first.markRevoked("user-1", "test", 1)).sessionRevision, 2);
    assert.equal((await repository(cfg).saveLogin(stored("user-1", "after-revoke"))).sessionRevision, 3);
    assert.equal((await repository(cfg).remove("user-1", { reason: "logout" })).sessionRevision, 4);
    assert.equal((await repository(cfg).saveLogin(stored("user-1", "after-logout"))).sessionRevision, 5);

    await fsp.unlink(canonicalSessionPath(cfg, "user-1"));
    assert.equal((await repository(cfg).saveLogin(stored("user-1", "after-manual-delete"))).sessionRevision, 6);
  });
});

test("provider mismatch preserves the local session and never invokes refresh", async () => {
  await withTempDir(async (root) => {
    const original = config(root, { supabaseUrl: "https://old-project.supabase.co" });
    await repository(original).saveLogin(stored("user-1", "old", 1, original.supabaseUrl));
    let refreshCalls = 0;
    const current = config(root, { supabaseUrl: "https://new-project.supabase.co" });
    const repo = repository(current, {
      refreshProvider: async () => {
        refreshCalls += 1;
        return stored("user-1", "unexpected");
      },
    });

    const result = await repo.resolve("user-1", { connected: true, force: true });
    assert.equal(result.status, "provider-mismatch");
    assert.equal(result.hasLocalSession, true);
    assert.equal(result.remoteUsable, false);
    assert.equal(result.requiresLogin, true);
    assert.equal(refreshCalls, 0);
    await fsp.access(canonicalSessionPath(current, "user-1"));
  });
});

test("an unavailable secure-storage provider never lets login overwrite the preserved envelope", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const protection = {
      encryptionAvailable: true,
      provider: "stabilization-keychain",
      encryptString: (value) => Buffer.from(value, "utf8").toString("base64").split("").reverse().join(""),
      decryptString: (value) => Buffer.from(value.split("").reverse().join(""), "base64").toString("utf8"),
    };
    configureSessionProtection(protection);
    try {
      await repository(cfg).saveLogin(stored("user-1", "preserved"));
      const sessionPath = canonicalSessionPath(cfg, "user-1");
      const before = await fsp.readFile(sessionPath, "utf8");
      configureSessionProtection(null);
      const unavailable = await repository(cfg).read("user-1");
      assert.equal(unavailable.status, "storage-unavailable");
      assert.equal(unavailable.hasLocalSession, true);
      await assert.rejects(
        () => repository(cfg).saveLogin(stored("user-1", "replacement")),
        (error) => error.code === "SESSION_STORAGE_UNAVAILABLE",
      );
      assert.equal(await fsp.readFile(sessionPath, "utf8"), before);
      const removed = await repository(cfg).remove("user-1", {
        forgetAccount: true,
        reason: "explicit-logout",
      });
      assert.equal(removed.removed, true);
      assert.equal(removed.sessionRevision, 2);
      await assert.rejects(() => fsp.access(sessionPath), (error) => error.code === "ENOENT");
    } finally {
      configureSessionProtection(null);
    }
  });
});

test("an old truncated lock is recoverable while a live lock remains protected", async () => {
  await withTempDir(async (root) => {
    const lockPath = path.join(root, "accounts", "locks", "truncated.lock");
    await fsp.mkdir(path.dirname(lockPath), { recursive: true });
    await fsp.writeFile(lockPath, "{", "utf8");
    const old = new Date(Date.now() - 10_000);
    await fsp.utimes(lockPath, old, old);
    const recovered = await acquireFileLock(lockPath, {
      malformedGraceMs: 5,
      retryMs: 2,
      timeoutMs: 100,
    });
    await recovered.release();

    const live = await acquireFileLock(lockPath, { timeoutMs: 100 });
    try {
      await assert.rejects(
        () => acquireFileLock(lockPath, { staleAfterMs: 1, timeoutMs: 20 }),
        (error) => error.code === "SESSION_LOCK_TIMEOUT",
      );
    } finally {
      await live.release();
    }
  });
});

test("known accounts repair an invalid pointer and preserve visual metadata across login", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await rememberAccount(cfg, {
      avatarUrl: "https://example.com/avatar.png",
      displayName: "Player One",
      email: "old@example.com",
      initials: "PO",
      userId: "user-1",
    });
    await rememberAccount(cfg, { email: null, userId: "user-1" }, { sessionRevision: 2 });
    const beforeCorruption = JSON.parse(await fsp.readFile(getKnownAccountsPath(cfg), "utf8"));
    beforeCorruption.lastActiveUserId = "missing-user";
    await fsp.writeFile(getKnownAccountsPath(cfg), JSON.stringify(beforeCorruption), "utf8");

    const store = await readKnownAccounts(cfg);
    assert.equal(store.lastActiveUserId, null);
    assert.equal(store.accounts[0].avatarUrl, "https://example.com/avatar.png");
    assert.equal(store.accounts[0].displayName, "Player One");
    assert.equal(store.accounts[0].email, "old@example.com");
    assert.equal(store.accounts[0].initials, "PO");
    assert.match(store.warnings.join("\n"), /lastActiveUserId.*reparado a null/);
  });
});

test("shutdown is idempotent, rejects new work and drains an abort-ignoring refresh", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    let started;
    const refreshStarted = new Promise((resolve) => { started = resolve; });
    const repo = repository(cfg, {
      refreshProvider: async () => {
        started();
        await new Promise(() => {});
      },
    });
    await repo.saveLogin(stored("user-1", "old", 1));
    const refresh = repo.resolve("user-1", { connected: true });
    await refreshStarted;

    const [first, second] = await Promise.all([
      repo.shutdown({ timeoutMs: 100, reason: "test" }),
      repo.shutdown({ timeoutMs: 100, reason: "test" }),
    ]);
    assert.equal(first.drained, true);
    assert.deepEqual(second, first);
    assert.equal((await refresh).status, "cancelled");
    assert.equal((await repo.resolve("user-1")).status, "cancelled");
  });
});

test("refresh backoff is per-account, honors Retry-After and resets after login", async () => {
  await withTempDir(async (root) => {
    let nowMs = Date.parse("2026-07-17T12:00:00.000Z");
    const cfg = config(root);
    const calls = new Map();
    const repo = repository(cfg, {
      now: () => nowMs,
      refreshBackoffScheduleMs: [1000],
      refreshProvider: async ({ userId }) => {
        calls.set(userId, (calls.get(userId) || 0) + 1);
        throw Object.assign(new Error("rate limited"), {
          retryAfterMs: 7000,
          sessionStatus: "temporary-failure",
          status: 429,
        });
      },
    });
    await repo.saveLogin(stored("user-a", "a", 1), { setActive: false });
    await repo.saveLogin(stored("user-b", "b", 1), { setActive: false });
    assert.equal((await repo.resolve("user-a", { connected: true })).status, "deferred");
    const backedOff = await repo.resolve("user-a", { connected: true });
    assert.equal(backedOff.reason, "refresh-backoff");
    assert.equal(calls.get("user-a"), 1);
    await repo.resolve("user-b", { connected: true });
    assert.equal(calls.get("user-b"), 1);
    nowMs += 7000;
    await repo.resolve("user-a", { connected: true });
    assert.equal(calls.get("user-a"), 2);
    await repo.saveLogin(stored("user-a", "fresh", 1));
    await repo.resolve("user-a", { connected: true });
    assert.equal(calls.get("user-a"), 3);
  });
});

test("generation-aware single-flight never gives a post-login caller the stale refresh promise", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    let started;
    let release;
    const refreshStarted = new Promise((resolve) => { started = resolve; });
    const repo = repository(cfg, {
      refreshProvider: async ({ storedSession }) => {
        started();
        await new Promise((resolve) => { release = resolve; });
        return { ...storedSession, session: { ...storedSession.session, expires_at: Math.floor(Date.now() / 1000) + 3600 } };
      },
    });
    await repo.saveLogin(stored("user-1", "old", 1));
    const oldRefresh = repo.resolve("user-1", { connected: true });
    await refreshStarted;
    const login = repo.saveLogin(stored("user-1", "new", Math.floor(Date.now() / 1000) + 3600));
    release();
    await Promise.all([oldRefresh, login]);
    const afterLogin = await repo.resolve("user-1", { connected: true });
    assert.equal(afterLogin.status, "valid");
    assert.equal(afterLogin.storedSession.session.refresh_token, "refresh-new");
  });
});

test("caller abort reaches an active provider refresh and is reported as cancellation", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    let started;
    const refreshStarted = new Promise((resolve) => { started = resolve; });
    let providerSignal;
    const repo = repository(cfg, {
      refreshProvider: async ({ signal }) => {
        providerSignal = signal;
        started();
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), {
            name: "AbortError",
          })), { once: true });
        });
      },
    });
    await repo.saveLogin(stored("user-1", "old", 1));
    const caller = new AbortController();
    const pending = repo.resolve("user-1", { connected: true, signal: caller.signal });
    await refreshStarted;
    caller.abort("caller-test");
    const cancelled = await pending;
    assert.equal(providerSignal.aborted, true);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.reason, "caller-test");
    assert.equal(cancelled.requiresLogin, false);
  });
});

test("global migration lock serializes repositories and recovery login completes the journal", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "legacy"), { expectedUserId: "user-1" });
    const left = repository(cfg);
    const right = repository(cfg);
    const results = await Promise.all([left.migrateLegacy(), right.migrateLegacy()]);
    assert.deepEqual(results.map((item) => item.status), ["completed", "completed"]);
    assert.equal((await left.read("user-1")).sessionRevision, 1);

    const savedAt = "2026-07-17T00:00:00.000Z";
    // Start a new migration cycle before constructing divergent legacy sources.
    await fsp.rm(migrationJournalPath(cfg), { force: true });
    await writeStoredSession(canonicalSessionPath(cfg, "user-1"), stored("user-1", "remembered", 100), {
      expectedRevision: 1,
      expectedUserId: "user-1",
      revision: 2,
      savedAt,
    });
    await writeStoredSession(cfg.sessionFileAbs, stored("user-1", "active", 100), { expectedUserId: "user-1", savedAt });
    const recovering = repository(cfg);
    assert.equal((await recovering.migrateLegacy()).status, "recovery-required");
    await recovering.saveLogin(stored("user-1", "recovered"));
    const journal = JSON.parse(await fsp.readFile(migrationJournalPath(cfg), "utf8"));
    assert.equal(journal.state, "completed");
    assert.equal(recovering.getDiagnosticsSnapshot().migrationStatus, "completed");
  });
});

test("a failed or unresolved migration blocks remote auth even if a canonical token exists", async () => {
  await withTempDir(async (root) => {
    const cfg = config(root);
    const real = repository(cfg);
    const saved = await real.saveLogin(stored("user-1", "blocked"));
    let resolveCalls = 0;
    const blockedRepository = {
      migrateLegacy: async () => ({ status: "recovery-required" }),
      read: (userId) => real.read(userId),
      resolve: async () => {
        resolveCalls += 1;
        return saved;
      },
    };
    const result = await resolveCanonicalSessionResult(cfg, { repository: blockedRepository });
    assert.equal(result.status, "recovery-required");
    assert.equal(result.remoteUsable, false);
    assert.equal(result.migrationRequired, true);
    assert.equal(result.sessionRevision, saved.sessionRevision);
    assert.equal(resolveCalls, 0);
  });
});

test("the repository cache normalizes provider URLs but separates incompatible anon keys", async () => {
  await withTempDir(async (root) => {
    const firstConfig = config(root, { supabaseAnonKey: "anon-one", supabaseUrl: "https://PROJECT.supabase.co/" });
    const equivalentConfig = config(root, { supabaseAnonKey: "anon-one", supabaseUrl: "https://project.supabase.co" });
    const rotatedKeyConfig = config(root, { supabaseAnonKey: "anon-two", supabaseUrl: "https://project.supabase.co" });
    const first = getAccountSessionRepository(firstConfig);
    assert.equal(getAccountSessionRepository(equivalentConfig), first);
    assert.notEqual(getAccountSessionRepository(rotatedKeyConfig), first);
  });
});
