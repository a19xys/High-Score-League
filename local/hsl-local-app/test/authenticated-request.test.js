const test = require("node:test");
const assert = require("node:assert/strict");
const { executeCanonicalAuthenticatedRequest } = require("../src/authenticated-request");
const { createSessionResult } = require("../src/session-result");

function session(status, token, overrides = {}) {
  return createSessionResult({
    reason: overrides.reason || status,
    sessionRevision: overrides.sessionRevision || 1,
    status,
    storedSession: token ? {
      schemaVersion: 1,
      session: { access_token: token, expires_at: 2_000_000_000, refresh_token: `refresh-${token}` },
      supabaseUrl: "https://example.supabase.co",
      user: { id: "user-1" },
    } : null,
    ...overrides,
  });
}

test("un primer 401 hace exactamente un refresh canónico y un retry con la credencial rotada", async () => {
  const tokens = [];
  let refreshes = 0;
  const result = await executeCanonicalAuthenticatedRequest({
    execute: async ({ accessToken }) => {
      tokens.push(accessToken);
      return { response: { status: tokens.length === 1 ? 401 : 200 } };
    },
    resolveSession: async ({ force }) => {
      if (!force) return session("valid", "old-token");
      refreshes += 1;
      return session("refreshed", "new-token", { sessionRevision: 2 });
    },
  });
  assert.equal(result.status, "response");
  assert.equal(refreshes, 1);
  assert.deepEqual(tokens, ["old-token", "new-token"]);
});

test("timeout o refresh superseded tras 401 se mantienen deferred y nunca requieren login", async () => {
  for (const deferredStatus of ["deferred", "stale", "cancelled", "lock-timeout", "storage-unavailable"]) {
    const result = await executeCanonicalAuthenticatedRequest({
      execute: async () => ({ response: { status: 401 } }),
      resolveSession: async ({ force }) => force
        ? session(deferredStatus, "old-token", { reason: `${deferredStatus}-fixture` })
        : session("valid", "old-token"),
    });
    assert.equal(result.status, "deferred", deferredStatus);
    assert.equal(result.sessionResult.requiresLogin, false, deferredStatus);
  }
});

test("solo un rechazo terminal del refresh canónico produce requires-login", async () => {
  const result = await executeCanonicalAuthenticatedRequest({
    execute: async () => ({ response: { status: 401 } }),
    resolveSession: async ({ force }) => force
      ? session("revoked", null, { reason: "refresh-token-rejected", sessionRevision: 2 })
      : session("valid", "old-token"),
  });
  assert.equal(result.status, "requires-login");
  assert.equal(result.sessionResult.status, "revoked");
  assert.equal(result.sessionResult.requiresLogin, true);
});

test("un segundo 401 tras refresh no inventa requiresLogin fuera de la autoridad canónica", async () => {
  const result = await executeCanonicalAuthenticatedRequest({
    execute: async () => ({ response: { status: 401 } }),
    resolveSession: async ({ force }) => force
      ? session("refreshed", "new-token", { sessionRevision: 2 })
      : session("valid", "old-token"),
  });
  assert.equal(result.status, "credential-rejected");
  assert.equal(result.sessionResult.requiresLogin, false);
});
