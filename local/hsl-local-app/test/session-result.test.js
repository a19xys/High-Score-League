const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REQUIRED_RESULT_FIELDS,
  SESSION_RESULT_STATUSES,
  assertSessionResult,
  createSessionResult,
  isCanonicalSessionResult,
  isSessionDeferred,
  isSessionLocallyAvailable,
  isSessionRemoteUsable,
  requiresSessionLogin,
  sanitizeSessionError,
} = require("../src/session-result");

test("every canonical status produces the complete immutable result contract", () => {
  for (const status of SESSION_RESULT_STATUSES) {
    const result = createSessionResult({
      sessionRevision: 7,
      status,
      storedSession: { session: { access_token: "access-secret", refresh_token: "refresh-secret" } },
    });
    assert.equal(isCanonicalSessionResult(result), true, status);
    assert.deepEqual(REQUIRED_RESULT_FIELDS.filter((field) => !(field in result)), [], status);
    assert.equal(result.status, status);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(assertSessionResult(result), result);
  }
});

test("missing and unknown statuses fail at the construction boundary", () => {
  assert.throws(() => createSessionResult(), (error) => error.code === "SESSION_RESULT_STATUS_REQUIRED");
  assert.throws(() => createSessionResult({ status: "deferred-offline" }), (error) => error.code === "SESSION_RESULT_STATUS_INVALID");
  assert.throws(
    () => createSessionResult({ sessionRevision: Number.MAX_SAFE_INTEGER + 1, status: "valid" }),
    (error) => error.code === "SESSION_RESULT_REVISION_INVALID",
  );
});

test("a preserved session never implies remote usability", () => {
  const storedSession = { user: { id: "user-1" }, session: { access_token: "expired", refresh_token: "preserved" } };
  const deferred = createSessionResult({ status: "deferred", storedSession });
  assert.equal(isSessionLocallyAvailable(deferred), true);
  assert.equal(isSessionRemoteUsable(deferred), false);
  assert.equal(isSessionDeferred(deferred), true);

  const usableResidualToken = createSessionResult({ remoteUsable: true, status: "deferred", storedSession });
  assert.equal(isSessionRemoteUsable(usableResidualToken), true);
  assert.equal(usableResidualToken.ok, false);
});

test("terminal auth states cannot retain or expose a remote-usable secret", () => {
  for (const status of ["revoked", "missing"]) {
    const result = createSessionResult({
      remoteUsable: true,
      status,
      storedSession: { session: { access_token: "secret", refresh_token: "secret" } },
    });
    assert.equal(result.storedSession, null);
    assert.equal(result.hasLocalSession, false);
    assert.equal(result.remoteUsable, false);
    assert.equal(requiresSessionLogin(result), true);
    assert.equal(result.terminal, true);
  }
});

test("recovery, provider and storage states remain locally explicit but never remotely usable", () => {
  const recovery = createSessionResult({ status: "recovery-required" });
  assert.equal(recovery.hasLocalSession, true);
  assert.equal(recovery.migrationRequired, true);
  assert.equal(recovery.remoteUsable, false);

  const mismatch = createSessionResult({ remoteUsable: true, status: "provider-mismatch" });
  assert.equal(mismatch.remoteUsable, false);
  assert.equal(mismatch.requiresLogin, true);

  const unavailable = createSessionResult({ status: "storage-unavailable" });
  assert.equal(unavailable.hasLocalSession, true);
  assert.equal(unavailable.requiresLogin, false);
  assert.equal(unavailable.shouldRetry, true);
});

test("session errors are bounded, sanitized and do not retain cause, body or stack", () => {
  const accessToken = "eyJabcdefghijk.eyJabcdefghijk.signaturevalue";
  const refreshToken = "refresh-super-secret";
  const error = Object.assign(new Error(`Authorization: Bearer ${accessToken}; refresh_token=${refreshToken}`), {
    body: { refresh_token: refreshToken },
    code: "HTTP_503",
    response: { body: refreshToken },
    status: 503,
  });
  const sanitized = sanitizeSessionError(error, { sensitiveValues: [accessToken, refreshToken] });
  const serialized = JSON.stringify(sanitized);
  assert.equal(sanitized.status, 503);
  assert.equal(sanitized.code, "HTTP_503");
  assert.doesNotMatch(serialized, /refresh-super-secret|eyJabcdefghijk|stack|cause|body|response/);
  assert.equal(Object.isFrozen(sanitized), true);
});

test("lock diagnostics expose only bounded non-secret fields", () => {
  const result = createSessionResult({
    lockState: { nonce: "secret-nonce", path: "C:/private/user", reason: "busy", status: "waiting", timeoutMs: 50, userId: "private-user", waitedMs: 10 },
    status: "lock-timeout",
  });
  assert.deepEqual(result.lockState, {
    ownerState: null,
    reason: "busy",
    status: "waiting",
    timeoutMs: 50,
    waitedMs: 10,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-nonce|private-user|C:\/private/);
});

test("helpers require explicit contract flags rather than storedSession presence", () => {
  const ambiguousLegacyValue = { status: "deferred", storedSession: { session: { access_token: "expired" } } };
  assert.equal(isSessionLocallyAvailable(ambiguousLegacyValue), false);
  assert.equal(isSessionRemoteUsable(ambiguousLegacyValue), false);
  assert.equal(requiresSessionLogin(ambiguousLegacyValue), false);
  assert.equal(isSessionDeferred(ambiguousLegacyValue), false);
  assert.equal(isCanonicalSessionResult(ambiguousLegacyValue), false);
  assert.throws(() => assertSessionResult(ambiguousLegacyValue), (error) => error.code === "SESSION_RESULT_CONTRACT_INVALID");
});
