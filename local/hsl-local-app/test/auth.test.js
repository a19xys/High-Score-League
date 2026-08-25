const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  classifySessionRefreshError,
  getAuthState,
  logoutLocal,
  saveSession,
  signInWithPassword,
} = require("../src/auth");
const { canonicalSessionPath } = require("../src/account-session-repository");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-auth-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function createConfig(root, overrides = {}) {
  return {
    sessionFileAbs: path.join(root, "userData", "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    userDataDir: path.join(root, "userData"),
    ...overrides,
  };
}

function validSession() {
  return {
    access_token: "access-token-secret",
    refresh_token: "refresh-token-secret",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
  };
}

function stubSupabase(response) {
  return {
    auth: {
      signInWithPassword: async () => response,
    },
  };
}

test("signInWithPassword saves a valid Supabase session", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    const result = await signInWithPassword(
      config,
      { email: "player@example.com", password: "correct-password" },
      {
        supabaseClient: stubSupabase({
          data: {
            session: validSession(),
            user: { id: "user-1", email: "player@example.com" },
          },
          error: null,
        }),
      }
    );

    const raw = await fsp.readFile(canonicalSessionPath(config, "user-1"), "utf8");

    assert.equal(result.ok, true);
    assert.equal(result.session.email, "player@example.com");
    assert.equal(JSON.stringify(result).includes("access-token-secret"), false);
    assert.equal(JSON.stringify(result).includes("correct-password"), false);
    assert.doesNotMatch(raw, /access-token-secret|refresh-token-secret/);
    assert.match(raw, /"schemaVersion": 2/);
    await assert.rejects(() => fsp.access(config.sessionFileAbs));
  });
});

test("signInWithPassword returns an error without saving when Supabase rejects login", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    let persistenceCalls = 0;
    const result = await signInWithPassword(
      config,
      { email: "player@example.com", password: "secret-password" },
      {
        repository: {
          migrateLegacy: async () => { persistenceCalls += 1; },
          saveLogin: async () => { persistenceCalls += 1; },
        },
        supabaseClient: stubSupabase({
          data: {},
          error: { message: "Invalid login for player@example.com with secret-password and anon-key" },
        }),
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, "auth_failed");
    assert.equal(result.message, "El email o la contraseña no son correctos. Inténtalo de nuevo.");
    assert.equal(persistenceCalls, 0);
    assert.equal(JSON.stringify(result).includes("secret-password"), false);
    assert.equal(JSON.stringify(result).includes("player@example.com"), false);
    assert.equal(JSON.stringify(result).includes("anon-key"), false);
    await assert.rejects(() => fsp.readFile(config.sessionFileAbs, "utf8"));
  });
});

test("signInWithPassword classifies and sanitizes a coded local persistence failure", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    const session = validSession();
    const persistenceError = Object.assign(new Error(
      `storage rejected player@example.com correct-password ${session.access_token} ${session.refresh_token} anon-key Authorization=Bearer eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.c2lnbmF0dXJl`
    ), { code: "SESSION_STORAGE_UNAVAILABLE" });
    persistenceError.stack = "stack-must-not-cross-boundary";
    const result = await signInWithPassword(
      config,
      { email: "player@example.com", password: "correct-password" },
      {
        repository: {
          migrateLegacy: async () => ({ status: "completed" }),
          saveLogin: async () => { throw persistenceError; },
        },
        supabaseClient: stubSupabase({
          data: { session, user: { id: "user-1", email: "player@example.com" } },
          error: null,
        }),
      }
    );
    const serialized = JSON.stringify(result);

    assert.equal(result.ok, false);
    assert.equal(result.status, "session_persistence_failed");
    assert.equal(result.reason, "local-session-persistence");
    assert.equal(result.errorCode, "SESSION_STORAGE_UNAVAILABLE");
    assert.doesNotMatch(result.message, /email o la contraseña no son correctos/i);
    assert.deepEqual(Object.keys(result.storage).sort(), ["encryptionAvailable", "provider", "warning"]);
    assert.doesNotMatch(serialized, /player@example\.com|correct-password|access-token-secret|refresh-token-secret|anon-key|eyJhbGci|stack-must-not-cross-boundary/);
    assert.equal(Object.hasOwn(result, "session"), false);
  });
});

test("signInWithPassword uses a stable fallback for an uncoded persistence failure", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    const session = validSession();
    const persistenceError = new Error(`cannot persist ${session.refresh_token}\u0000 correct-password`);
    persistenceError.stack = "raw-stack-secret";
    const result = await signInWithPassword(
      config,
      { email: "player@example.com", password: "correct-password" },
      {
        repository: {
          migrateLegacy: async () => ({ status: "completed" }),
          saveLogin: async () => { throw persistenceError; },
        },
        supabaseClient: stubSupabase({
          data: { session, user: { id: "user-1", email: "player@example.com" } },
          error: null,
        }),
      }
    );
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "session_persistence_failed");
    assert.equal(result.errorCode, "SESSION_PERSISTENCE_FAILED");
    assert.ok(result.technicalMessage.length <= 280);
    assert.doesNotMatch(serialized, /refresh-token-secret|correct-password|raw-stack-secret|\\u0000/);
  });
});

test("signInWithPassword does not save when Supabase omits the session", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    const result = await signInWithPassword(
      config,
      { email: "player@example.com", password: "correct-password" },
      {
        supabaseClient: stubSupabase({
          data: { user: { id: "user-1", email: "player@example.com" } },
          error: null,
        }),
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, "missing_session");
    await assert.rejects(() => fsp.readFile(config.sessionFileAbs, "utf8"));
  });
});

test("logoutLocal deletes only the canonical session and leaves no legacy session", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    await saveSession(config, validSession(), { id: "user-1", email: "player@example.com" });

    const result = await logoutLocal(config);

    assert.equal(result.ok, true);
    assert.equal(result.session.hasSession, false);
    await assert.rejects(() => fsp.access(canonicalSessionPath(config, "user-1")));
    await assert.rejects(() => fsp.readFile(config.sessionFileAbs, "utf8"));
  });
});

test("getAuthState returns disconnected state when no session exists", async () => {
  await withTempDir(async (dir) => {
    const state = await getAuthState(createConfig(dir));

    assert.equal(state.hasSession, false);
    assert.equal(state.status, "missing");
    assert.equal(state.requiresLogin, false);
    assert.equal(JSON.stringify(state).includes("access_token"), false);
  });
});

test("refresh errors only require login when provider evidence is conclusive", () => {
  const recoverable = [
    Object.assign(new Error("timeout"), { failureType: "timeout" }),
    Object.assign(new Error("rate limit"), { providerCode: "rate_limit", status: 429 }),
    Object.assign(new Error("provider down"), { providerCode: "provider_unavailable", status: 503 }),
    Object.assign(new Error("transport"), { code: "ENOTFOUND" }),
    Object.assign(new Error("cancelled"), { name: "AbortError" }),
  ];
  for (const error of recoverable) assert.equal(classifySessionRefreshError(error).transient, true);

  for (const code of ["invalid_refresh_token", "refresh_token_not_found", "refresh_token_revoked"]) {
    assert.deepEqual(classifySessionRefreshError({ providerCode: code, status: 401 }), {
      reason: "refresh-token-rejected",
      status: "revoked",
      transient: false,
    });
  }
});

test("getAuthState returns connected state without exposing tokens", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    await saveSession(config, validSession(), { id: "user-1", email: "player@example.com" });

    const state = await getAuthState(config);

    assert.equal(state.hasSession, true);
    assert.equal(state.email, "player@example.com");
    assert.equal(JSON.stringify(state).includes("access-token-secret"), false);
    assert.equal(JSON.stringify(state).includes("refresh-token-secret"), false);
  });
});

test("getAuthState can defer remote refresh for local pack activation", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    const expiringSession = {
      ...validSession(),
      expires_at: Math.floor(Date.now() / 1000) + 5,
    };
    await saveSession(config, expiringSession, { id: "user-1", email: "player@example.com" });

    const state = await getAuthState(config, { deferRemote: true });

    assert.equal(state.hasSession, true);
    assert.equal(state.email, "player@example.com");
    assert.equal(JSON.stringify(state).includes("refresh-token-secret"), false);
  });
});
