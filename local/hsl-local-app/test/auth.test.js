const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getAuthState,
  logoutLocal,
  saveSession,
  signInWithPassword,
} = require("../src/auth");

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

    const raw = await fsp.readFile(config.sessionFileAbs, "utf8");

    assert.equal(result.ok, true);
    assert.equal(result.session.email, "player@example.com");
    assert.equal(JSON.stringify(result).includes("access-token-secret"), false);
    assert.equal(JSON.stringify(result).includes("correct-password"), false);
    assert.match(raw, /access-token-secret/);
  });
});

test("signInWithPassword returns an error without saving when Supabase rejects login", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    const result = await signInWithPassword(
      config,
      { email: "player@example.com", password: "secret-password" },
      {
        supabaseClient: stubSupabase({
          data: {},
          error: { message: "Invalid login for secret-password" },
        }),
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, "auth_failed");
    assert.equal(JSON.stringify(result).includes("secret-password"), false);
    await assert.rejects(() => fsp.readFile(config.sessionFileAbs, "utf8"));
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

test("logoutLocal deletes only the local session file", async () => {
  await withTempDir(async (dir) => {
    const config = createConfig(dir);
    await saveSession(config, validSession(), { id: "user-1", email: "player@example.com" });

    const result = await logoutLocal(config);

    assert.equal(result.ok, true);
    assert.equal(result.session.hasSession, false);
    await assert.rejects(() => fsp.readFile(config.sessionFileAbs, "utf8"));
  });
});

test("getAuthState returns disconnected state when no session exists", async () => {
  await withTempDir(async (dir) => {
    const state = await getAuthState(createConfig(dir));

    assert.equal(state.hasSession, false);
    assert.equal(state.status, "missing");
    assert.equal(JSON.stringify(state).includes("access_token"), false);
  });
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
