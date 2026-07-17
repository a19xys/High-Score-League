const { evaluateAccessToken } = require("./session-refresh-policy");

const SESSION_RESULT_STATUSES = Object.freeze([
  "valid",
  "refreshed",
  "deferred",
  "revoked",
  "corrupt",
  "missing",
  "recovery-required",
  "cancelled",
  "stale",
  "lock-timeout",
  "provider-mismatch",
  "storage-unavailable",
]);

const STATUS_SET = new Set(SESSION_RESULT_STATUSES);
const REQUIRED_RESULT_FIELDS = Object.freeze([
  "status",
  "ok",
  "hasLocalSession",
  "remoteUsable",
  "shouldRetry",
  "requiresLogin",
  "terminal",
  "sessionRevision",
  "storedSession",
  "reason",
  "error",
  "stale",
  "migrationRequired",
  "lockState",
  "retryAfterMs",
]);

const STATUS_PROFILES = Object.freeze({
  valid: Object.freeze({ hasLocalSession: true, ok: true, remoteUsable: true, shouldRetry: false, requiresLogin: false, terminal: true }),
  refreshed: Object.freeze({ hasLocalSession: true, ok: true, remoteUsable: true, shouldRetry: false, requiresLogin: false, terminal: true }),
  deferred: Object.freeze({ allowRemoteUsable: true, ok: false, remoteUsable: false, shouldRetry: true, requiresLogin: false, terminal: false }),
  revoked: Object.freeze({ discardStoredSession: true, hasLocalSession: false, ok: false, remoteUsable: false, shouldRetry: false, requiresLogin: true, terminal: true }),
  corrupt: Object.freeze({ hasLocalSession: true, ok: false, remoteUsable: false, shouldRetry: false, requiresLogin: true, terminal: true }),
  missing: Object.freeze({ discardStoredSession: true, hasLocalSession: false, ok: false, remoteUsable: false, shouldRetry: false, requiresLogin: true, terminal: true }),
  "recovery-required": Object.freeze({ hasLocalSession: true, migrationRequired: true, ok: false, remoteUsable: false, shouldRetry: false, requiresLogin: true, terminal: true }),
  cancelled: Object.freeze({ ok: false, remoteUsable: false, shouldRetry: true, requiresLogin: false, terminal: false }),
  stale: Object.freeze({ ok: false, remoteUsable: false, shouldRetry: true, requiresLogin: false, stale: true, terminal: false }),
  "lock-timeout": Object.freeze({ ok: false, remoteUsable: false, shouldRetry: true, requiresLogin: false, terminal: false }),
  "provider-mismatch": Object.freeze({ hasLocalSession: true, ok: false, remoteUsable: false, shouldRetry: false, requiresLogin: true, terminal: true }),
  "storage-unavailable": Object.freeze({ hasLocalSession: true, ok: false, remoteUsable: false, shouldRetry: true, requiresLogin: false, terminal: false }),
});

const SENSITIVE_KEY_PATTERN = /((?:access|refresh|provider|id)?_?token|authorization|password|passcode|api[_-]?key|apikey|secret)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const SENSITIVE_QUERY_PATTERN = /([?&](?:access_token|refresh_token|token|password|api[_-]?key|apikey|secret)=)[^&#\s]*/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;

function resultContractError(message, code) {
  return Object.assign(new TypeError(message), { code });
}

function redactText(value, sensitiveValues = []) {
  let text = String(value ?? "");
  for (const sensitiveValue of sensitiveValues) {
    if (typeof sensitiveValue !== "string" || sensitiveValue.length === 0) continue;
    text = text.split(sensitiveValue).join("[redacted]");
  }
  return text
    .replace(SENSITIVE_QUERY_PATTERN, "$1[redacted]")
    .replace(SENSITIVE_KEY_PATTERN, "$1$2[redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[redacted-jwt]");
}

function boundedText(value, maxLength, sensitiveValues = []) {
  if (value === undefined || value === null) return null;
  const redacted = redactText(value, sensitiveValues).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!redacted) return null;
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

function sanitizeSessionError(error, options = {}) {
  if (!error) return null;
  const sensitiveValues = Array.isArray(options.sensitiveValues) ? options.sensitiveValues : [];
  const source = typeof error === "object" ? error : { message: String(error) };
  const numericStatus = Number(source.status ?? source.httpStatus ?? source.cause?.status);
  const status = Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599
    ? numericStatus
    : null;
  const name = boundedText(source.name || "Error", 64, sensitiveValues) || "Error";
  const code = boundedText(source.code ?? source.errorCode ?? source.cause?.code, 96, sensitiveValues);
  const message = boundedText(source.message || "Session operation failed.", 384, sensitiveValues) || "Session operation failed.";
  return Object.freeze({ code, message, name, status });
}

function sanitizeLockState(lockState, status) {
  if (!lockState && status !== "lock-timeout") return null;
  if (typeof lockState === "string") {
    return Object.freeze({ status: boundedText(lockState, 64) || "unknown" });
  }
  const source = lockState && typeof lockState === "object" ? lockState : {};
  const waitedMs = Number(source.waitedMs);
  const timeoutMs = Number(source.timeoutMs);
  return Object.freeze({
    ownerState: boundedText(source.ownerState, 64),
    reason: boundedText(source.reason, 96),
    status: boundedText(source.status, 64) || (status === "lock-timeout" ? "timeout" : "unknown"),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.round(timeoutMs) : null,
    waitedMs: Number.isFinite(waitedMs) && waitedMs >= 0 ? Math.round(waitedMs) : null,
  });
}

function normalizeSessionRevision(value) {
  if (value === undefined || value === null) return 0;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw resultContractError("sessionRevision must be a non-negative safe integer.", "SESSION_RESULT_REVISION_INVALID");
  }
  return revision;
}

function normalizeRetryAfterMs(value) {
  if (value === undefined || value === null) return null;
  const retryAfterMs = Number(value);
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    throw resultContractError("retryAfterMs must be a non-negative finite number or null.", "SESSION_RESULT_RETRY_AFTER_INVALID");
  }
  return Math.round(retryAfterMs);
}

function createSessionResult(input = {}) {
  const status = input.status;
  if (typeof status !== "string" || !STATUS_SET.has(status)) {
    throw resultContractError(
      status ? `Unknown session result status: ${String(status)}` : "Session result status is required.",
      status ? "SESSION_RESULT_STATUS_INVALID" : "SESSION_RESULT_STATUS_REQUIRED",
    );
  }
  const profile = STATUS_PROFILES[status];
  const storedSession = profile.discardStoredSession ? null : input.storedSession ?? null;
  const hasLocalSession = typeof profile.hasLocalSession === "boolean"
    ? profile.hasLocalSession
    : input.hasLocalSession === true || Boolean(storedSession);
  const requiresLogin = profile.requiresLogin;
  const remoteUsable = hasLocalSession && !requiresLogin && (
    profile.remoteUsable === true || (profile.allowRemoteUsable === true && input.remoteUsable === true)
  );
  const sensitiveValues = [
    ...(Array.isArray(input.sensitiveValues) ? input.sensitiveValues : []),
    input.storedSession?.session?.access_token,
    input.storedSession?.session?.refresh_token,
  ].filter((value) => typeof value === "string" && value.length > 0);

  return Object.freeze({
    status,
    ok: profile.ok,
    hasLocalSession,
    remoteUsable,
    shouldRetry: profile.shouldRetry,
    requiresLogin,
    terminal: profile.terminal,
    sessionRevision: normalizeSessionRevision(input.sessionRevision),
    storedSession,
    reason: boundedText(input.reason, 160, sensitiveValues) || status,
    error: sanitizeSessionError(input.error, { sensitiveValues }),
    stale: profile.stale === true || input.stale === true,
    migrationRequired: profile.migrationRequired === true || input.migrationRequired === true,
    lockState: sanitizeLockState(input.lockState, status),
    retryAfterMs: normalizeRetryAfterMs(input.retryAfterMs),
  });
}

function isCanonicalSessionResult(result) {
  if (!result || typeof result !== "object" || !STATUS_SET.has(result.status)) return false;
  if (!REQUIRED_RESULT_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(result, field))) return false;
  if (!["ok", "hasLocalSession", "remoteUsable", "shouldRetry", "requiresLogin", "terminal", "stale", "migrationRequired"]
    .every((field) => typeof result[field] === "boolean")) return false;
  if (!Number.isSafeInteger(result.sessionRevision) || result.sessionRevision < 0) return false;
  if (result.remoteUsable && (!result.hasLocalSession || result.requiresLogin)) return false;
  if (result.error !== null && typeof result.error !== "object") return false;
  if (result.lockState !== null && typeof result.lockState !== "object") return false;
  if (result.retryAfterMs !== null && (!Number.isFinite(result.retryAfterMs) || result.retryAfterMs < 0)) return false;
  return true;
}

function assertSessionResult(result) {
  if (!isCanonicalSessionResult(result)) {
    throw resultContractError("Value does not satisfy the canonical session result contract.", "SESSION_RESULT_CONTRACT_INVALID");
  }
  return result;
}

function isSessionLocallyAvailable(result) {
  return result?.hasLocalSession === true;
}

function isSessionRemoteUsable(result) {
  return result?.remoteUsable === true && result?.requiresLogin !== true;
}

function isSessionRemoteUsableNow(result, options = {}) {
  if (!isSessionRemoteUsable(result) || !result?.storedSession) return false;
  const configuredProviderUrl = options.configuredProviderUrl || options.config?.supabaseUrl || null;
  return evaluateAccessToken(result.storedSession, {
    absoluteUsabilitySeconds: options.absoluteUsabilitySeconds,
    configuredProviderUrl,
    expectedUserId: result.storedSession.user?.id,
    nowMs: options.nowMs,
    providerBound: !configuredProviderUrl,
    storedFingerprint: result.storedSession.providerFingerprint,
  }).remoteUsable;
}

function requiresSessionLogin(result) {
  return result?.requiresLogin === true;
}

function isSessionDeferred(result) {
  return result?.terminal === false && result?.shouldRetry === true && result?.requiresLogin !== true;
}

module.exports = {
  REQUIRED_RESULT_FIELDS,
  SESSION_RESULT_STATUSES,
  assertSessionResult,
  createSessionResult,
  isCanonicalSessionResult,
  isSessionDeferred,
  isSessionLocallyAvailable,
  isSessionRemoteUsable,
  isSessionRemoteUsableNow,
  requiresSessionLogin,
  sanitizeSessionError,
};
