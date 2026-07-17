const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProviderFingerprint,
  createSessionRefreshBackoff,
  evaluateAccessToken,
  evaluateProviderBinding,
  normalizeProviderUrl,
  parseRetryAfterMs,
} = require("../src/session-refresh-policy");

function jwt(subject) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: subject })}.signature`;
}

function storedSession(overrides = {}) {
  const { session: sessionOverrides = {}, ...storedOverrides } = overrides;
  return {
    session: {
      access_token: jwt("user-1"),
      expires_at: 1060,
      refresh_token: "refresh-secret",
      ...sessionOverrides,
    },
    supabaseUrl: "https://Project-A.supabase.co/",
    user: { id: "user-1" },
    ...storedOverrides,
  };
}

test("provider URLs normalize only origin-equivalent HTTP(S) values", () => {
  assert.equal(normalizeProviderUrl(" https://Project-A.SUPABASE.co/ "), "https://project-a.supabase.co");
  assert.equal(normalizeProviderUrl("https://project-a.supabase.co:443///"), "https://project-a.supabase.co");
  assert.equal(normalizeProviderUrl("http://localhost:54321/"), "http://localhost:54321");
  for (const invalid of [
    "ftp://project-a.supabase.co",
    "https://user:password@project-a.supabase.co",
    "https://project-a.supabase.co/auth/v1",
    "https://project-a.supabase.co/?key=value",
    "not-a-url",
    "",
  ]) assert.equal(normalizeProviderUrl(invalid), null, invalid);
});

test("provider fingerprints are stable for equivalent origins and differ across projects", () => {
  const first = createProviderFingerprint("https://PROJECT-A.supabase.co/");
  assert.equal(first, createProviderFingerprint("https://project-a.supabase.co"));
  assert.notEqual(first, createProviderFingerprint("https://project-b.supabase.co"));
  assert.match(first, /^provider_[a-f0-9]{24}$/);
});

test("provider binding accepts a normalized legacy URL and rejects protocol, host and port changes", () => {
  const match = evaluateProviderBinding({
    configuredUrl: "https://project-a.supabase.co",
    storedUrl: "https://PROJECT-A.supabase.co/",
  });
  assert.equal(match.matches, true);
  assert.equal(match.legacyBinding, true);
  assert.equal(match.remoteUsable, true);

  for (const storedUrl of [
    "http://project-a.supabase.co",
    "https://project-b.supabase.co",
    "https://project-a.supabase.co:444",
  ]) {
    const mismatch = evaluateProviderBinding({ configuredUrl: "https://project-a.supabase.co", storedUrl });
    assert.equal(mismatch.matches, false, storedUrl);
    assert.equal(mismatch.status, "provider-mismatch", storedUrl);
    assert.equal(mismatch.remoteUsable, false, storedUrl);
    assert.equal(mismatch.requiresLogin, true, storedUrl);
  }
});

test("missing, invalid and inconsistent provider identities fail closed", () => {
  assert.equal(evaluateProviderBinding({ configuredUrl: "https://project-a.supabase.co" }).reason, "stored-provider-missing");
  assert.equal(evaluateProviderBinding({ configuredUrl: "invalid", storedUrl: "https://project-a.supabase.co" }).status, "invalid-config");
  const mismatch = evaluateProviderBinding({
    configuredUrl: "https://project-a.supabase.co",
    storedFingerprint: createProviderFingerprint("https://project-b.supabase.co"),
    storedUrl: "https://project-a.supabase.co",
  });
  assert.equal(mismatch.matches, false);
  assert.equal(mismatch.reason, "stored-provider-fingerprint-invalid");
});

test("fresh and refresh-threshold tokens have distinct refresh and usability decisions", () => {
  const binding = evaluateProviderBinding({
    configuredUrl: "https://project-a.supabase.co",
    storedUrl: "https://project-a.supabase.co",
  });
  const fresh = evaluateAccessToken(storedSession({ session: { expires_at: 1200 } }), {
    nowMs: 1000 * 1000,
    providerBinding: binding,
  });
  assert.equal(fresh.remoteUsable, true);
  assert.equal(fresh.shouldRefresh, false);
  assert.equal(fresh.reason, "token-usable");

  const threshold = evaluateAccessToken(storedSession({ session: { expires_at: 1045 } }), {
    nowMs: 1000 * 1000,
    providerBinding: binding,
  });
  assert.equal(threshold.remoteUsable, true);
  assert.equal(threshold.shouldRefresh, true);
  assert.equal(threshold.reason, "refresh-recommended");
});

test("expired, near-dead, invalid and unbound tokens are never remotely usable", () => {
  const binding = evaluateProviderBinding({ configuredUrl: "https://project-a.supabase.co", storedUrl: "https://project-a.supabase.co" });
  const cases = [
    [storedSession({ session: { expires_at: 999 } }), { providerBinding: binding }, "token-expired"],
    [storedSession({ session: { expires_at: 1005 } }), { providerBinding: binding }, "token-lifetime-insufficient"],
    [storedSession({ session: { expires_at: "invalid" } }), { providerBinding: binding }, "expiry-invalid"],
    [storedSession({ session: { expires_at: null } }), { providerBinding: binding }, "expiry-missing"],
    [storedSession(), {}, "provider-unverified"],
    [storedSession(), { providerBinding: binding, requiresLogin: true }, "requires-login"],
    [storedSession(), { migrationRequired: true, providerBinding: binding }, "migration-required"],
  ];
  for (const [session, options, reason] of cases) {
    const result = evaluateAccessToken(session, { nowMs: 1000 * 1000, ...options });
    assert.equal(result.remoteUsable, false, reason);
    assert.equal(result.reason, reason);
  }
});

test("token identity must agree with the canonical account", () => {
  const binding = evaluateProviderBinding({ configuredUrl: "https://project-a.supabase.co", storedUrl: "https://project-a.supabase.co" });
  const mismatch = evaluateAccessToken(storedSession({ session: { access_token: jwt("other-user") } }), {
    nowMs: 1000 * 1000,
    providerBinding: binding,
  });
  assert.equal(mismatch.identityMatches, false);
  assert.equal(mismatch.remoteUsable, false);
  assert.equal(mismatch.reason, "token-identity-mismatch");
});

test("429 Retry-After blocks only one user for the exact remaining interval", () => {
  let now = Date.parse("2026-07-17T10:00:00.000Z");
  const backoff = createSessionRefreshBackoff({ now: () => now, scheduleMs: [30000, 60000] });
  const failure = backoff.recordFailure("user-a", { retryAfter: "120", status: 429 });
  assert.equal(failure.applied, true);
  assert.equal(failure.delayMs, 120000);
  assert.equal(backoff.canAttempt("user-a").allowed, false);
  assert.equal(backoff.canAttempt("user-a").retryAfterMs, 120000);
  assert.equal(backoff.canAttempt("user-b").allowed, true);

  now += 45000;
  assert.equal(backoff.canAttempt("user-a").retryAfterMs, 75000);
  now += 75000;
  assert.equal(backoff.canAttempt("user-a").allowed, true);
});

test("5xx and timeout failures back off exponentially and success/login reset", () => {
  let now = 1000000;
  const backoff = createSessionRefreshBackoff({ now: () => now, scheduleMs: [1000, 2000, 4000] });
  assert.equal(backoff.recordFailure("user-a", { status: 503 }).delayMs, 1000);
  now += 1000;
  assert.equal(backoff.recordFailure("user-a", { failureType: "timeout" }).delayMs, 2000);
  assert.equal(backoff.getState("user-a").attempt, 2);
  assert.equal(backoff.recordSuccess("user-a"), true);
  assert.equal(backoff.getState("user-a"), null);
  backoff.recordFailure("user-a", { status: 500 });
  assert.equal(backoff.recordLogin("user-a"), true);
  assert.equal(backoff.size(), 0);
});

test("cancellation and conclusive failures do not create refresh cooldown", () => {
  const backoff = createSessionRefreshBackoff({ scheduleMs: [1000] });
  assert.equal(backoff.recordFailure("user-a", { failureType: "cancelled" }).applied, false);
  assert.equal(backoff.recordFailure("user-a", { status: 401 }).applied, false);
  assert.equal(backoff.canAttempt("user-a").allowed, true);
  assert.equal(backoff.size(), 0);
});

test("Retry-After dates and diagnostics are deterministic and identity-sanitized", () => {
  const now = Date.parse("2026-07-17T10:00:00.000Z");
  assert.equal(parseRetryAfterMs("Fri, 17 Jul 2026 10:02:00 GMT", now, 900000), 120000);
  const backoff = createSessionRefreshBackoff({ now: () => now, scheduleMs: [1000] });
  backoff.recordFailure("private-user-id", { status: 500 });
  const serialized = JSON.stringify(backoff.getDiagnostics());
  assert.match(serialized, /user_[a-f0-9]{12}/);
  assert.doesNotMatch(serialized, /private-user-id/);
});
