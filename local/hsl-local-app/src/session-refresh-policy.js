const crypto = require("node:crypto");

const DEFAULT_REFRESH_THRESHOLD_SECONDS = 60;
const DEFAULT_ABSOLUTE_USABILITY_SECONDS = 5;
const DEFAULT_BACKOFF_SCHEDULE_MS = Object.freeze([30000, 60000, 120000, 300000, 900000]);
const DEFAULT_MAX_RETRY_AFTER_MS = 15 * 60 * 1000;

function normalizeProviderUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!parsed.hostname || !/^\/+$/u.test(parsed.pathname || "/")) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function providerProjectRef(normalizedUrl) {
  try {
    const hostname = new URL(normalizedUrl).hostname.toLowerCase();
    const labels = hostname.split(".");
    return labels.length >= 3 && labels.slice(-2).join(".") === "supabase.co" ? labels[0] : null;
  } catch {
    return null;
  }
}

function createProviderFingerprint(value) {
  const origin = normalizeProviderUrl(value);
  if (!origin) return null;
  return `provider_${crypto.createHash("sha256").update(origin).digest("hex").slice(0, 24)}`;
}

function getProviderIdentity(value) {
  const origin = normalizeProviderUrl(value);
  if (!origin) return null;
  const parsed = new URL(origin);
  return Object.freeze({
    fingerprint: createProviderFingerprint(origin),
    hostname: parsed.hostname,
    origin,
    port: parsed.port || null,
    projectRef: providerProjectRef(origin),
    protocol: parsed.protocol,
  });
}

function evaluateProviderBinding(input = {}, configuredUrlArgument) {
  const options = typeof input === "string"
    ? { storedUrl: input, configuredUrl: configuredUrlArgument }
    : input || {};
  const stored = getProviderIdentity(options.storedUrl ?? options.storedProviderUrl ?? options.storedSession?.supabaseUrl);
  const configured = getProviderIdentity(options.configuredUrl ?? options.configuredProviderUrl ?? options.config?.supabaseUrl);
  const declaredFingerprint = typeof options.storedFingerprint === "string" && options.storedFingerprint
    ? options.storedFingerprint
    : null;

  let reason = "provider-match";
  if (!configured) reason = options.configuredUrl || options.configuredProviderUrl || options.config?.supabaseUrl
    ? "configured-provider-invalid"
    : "configured-provider-missing";
  else if (!stored) reason = options.storedUrl || options.storedProviderUrl || options.storedSession?.supabaseUrl
    ? "stored-provider-invalid"
    : "stored-provider-missing";
  else if (declaredFingerprint && declaredFingerprint !== stored.fingerprint) reason = "stored-provider-fingerprint-invalid";
  else if (stored.origin !== configured.origin) reason = "provider-origin-mismatch";
  else if (declaredFingerprint && declaredFingerprint !== configured.fingerprint) reason = "provider-fingerprint-mismatch";

  const matches = reason === "provider-match";
  return Object.freeze({
    configuredFingerprint: configured?.fingerprint || null,
    configuredOrigin: configured?.origin || null,
    legacyBinding: matches && !declaredFingerprint,
    matches,
    reason,
    remoteUsable: matches,
    requiresLogin: !matches && Boolean(configured),
    status: matches ? "matched" : configured ? "provider-mismatch" : "invalid-config",
    storedFingerprint: stored?.fingerprint || declaredFingerprint,
    storedOrigin: stored?.origin || null,
  });
}

function normalizeNonNegativeSeconds(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function decodeJwtSubject(token) {
  if (typeof token !== "string" || !token.includes(".")) return { malformed: false, subject: null };
  const parts = token.split(".");
  if (parts.length !== 3) return { malformed: true, subject: null };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return { malformed: false, subject: typeof payload?.sub === "string" ? payload.sub : null };
  } catch {
    return { malformed: true, subject: null };
  }
}

function evaluateAccessToken(storedSession, options = {}) {
  const session = storedSession?.session || storedSession || {};
  const accessToken = typeof session.access_token === "string" && session.access_token.length > 0
    ? session.access_token
    : null;
  const hasRefreshToken = typeof session.refresh_token === "string" && session.refresh_token.length > 0;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const absoluteUsabilitySeconds = normalizeNonNegativeSeconds(
    options.absoluteUsabilitySeconds,
    DEFAULT_ABSOLUTE_USABILITY_SECONDS,
  );
  const refreshThresholdSeconds = Math.max(
    absoluteUsabilitySeconds,
    normalizeNonNegativeSeconds(options.refreshThresholdSeconds, DEFAULT_REFRESH_THRESHOLD_SECONDS),
  );
  const rawExpiresAt = session.expires_at;
  const expiresAt = Number(rawExpiresAt);
  const expiryValid = rawExpiresAt !== undefined && rawExpiresAt !== null && rawExpiresAt !== "" &&
    Number.isFinite(expiresAt) && expiresAt > 0 && Number.isSafeInteger(expiresAt);
  const secondsRemaining = expiryValid ? expiresAt - nowSeconds : null;
  const expired = expiryValid ? secondsRemaining <= 0 : false;
  const withinRefreshThreshold = expiryValid ? secondsRemaining <= refreshThresholdSeconds : true;
  const binding = options.providerBinding || (
    options.configuredProviderUrl || options.config?.supabaseUrl
      ? evaluateProviderBinding({
          configuredUrl: options.configuredProviderUrl ?? options.config?.supabaseUrl,
          storedFingerprint: options.storedFingerprint,
          storedSession,
        })
      : null
  );
  const providerBound = binding?.matches === true || options.providerBound === true;
  const storedUserId = storedSession?.user?.id || options.storedUserId || null;
  const expectedUserId = options.expectedUserId || storedUserId;
  const jwt = decodeJwtSubject(accessToken);
  const identityMatches = Boolean(storedUserId) && (!expectedUserId || storedUserId === expectedUserId) &&
    !jwt.malformed && (!jwt.subject || jwt.subject === storedUserId);

  let reason = "token-usable";
  if (options.requiresLogin === true) reason = "requires-login";
  else if (options.migrationRequired === true) reason = "migration-required";
  else if (!providerBound) reason = binding?.reason || "provider-unverified";
  else if (!storedUserId || !identityMatches) reason = jwt.malformed ? "token-malformed" : "token-identity-mismatch";
  else if (!accessToken) reason = "access-token-missing";
  else if (!expiryValid) reason = rawExpiresAt === undefined || rawExpiresAt === null || rawExpiresAt === ""
    ? "expiry-missing"
    : "expiry-invalid";
  else if (expired) reason = "token-expired";
  else if (secondsRemaining <= absoluteUsabilitySeconds) reason = "token-lifetime-insufficient";
  else if (withinRefreshThreshold) reason = "refresh-recommended";

  const remoteUsable = ["token-usable", "refresh-recommended"].includes(reason);
  return Object.freeze({
    absoluteUsabilitySeconds,
    expired,
    expiresAt: expiryValid ? expiresAt : null,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken,
    identityMatches,
    providerBound,
    reason,
    remoteUsable,
    secondsRemaining,
    shouldRefresh: hasRefreshToken && (!expiryValid || withinRefreshThreshold),
    refreshThresholdSeconds,
    withinRefreshThreshold,
  });
}

function parseRetryAfterMs(value, nowMs, maxRetryAfterMs) {
  if (value === undefined || value === null || value === "") return null;
  let delayMs;
  if (typeof value === "number") delayMs = value;
  else if (/^\d+(?:\.\d+)?$/.test(String(value).trim())) delayMs = Number(value) * 1000;
  else {
    const target = Date.parse(String(value));
    delayMs = Number.isFinite(target) ? target - nowMs : NaN;
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) return null;
  return Math.min(Math.round(delayMs), maxRetryAfterMs);
}

function classifyRefreshFailure(input = {}) {
  const error = input.error || {};
  const statusValue = Number(input.status ?? input.httpStatus ?? error.status ?? error.cause?.status);
  const status = Number.isInteger(statusValue) ? statusValue : null;
  const failureType = String(input.failureType || input.type || "").toLowerCase();
  const code = String(input.code || error.code || error.cause?.code || "").toUpperCase();
  const reason = String(input.reason || "").toLowerCase();
  if (status === 429) return Object.freeze({ reason: "rate-limited", retryable: true, status });
  if (status !== null && status >= 500 && status <= 599) return Object.freeze({ reason: "provider-unavailable", retryable: true, status });
  if (failureType === "timeout" || reason.includes("timeout") || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) {
    return Object.freeze({ reason: "timeout", retryable: true, status });
  }
  if (input.retryable === true && failureType !== "cancelled") {
    return Object.freeze({ reason: reason || "transient", retryable: true, status });
  }
  return Object.freeze({ reason: failureType === "cancelled" ? "cancelled" : reason || "non-retryable", retryable: false, status });
}

function safeUserHash(userId) {
  return `user_${crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 12)}`;
}

function createSessionRefreshBackoff(options = {}) {
  const states = new Map();
  const schedule = Array.isArray(options.scheduleMs) && options.scheduleMs.length > 0
    ? options.scheduleMs.map(Number).filter((value) => Number.isFinite(value) && value >= 0)
    : [...DEFAULT_BACKOFF_SCHEDULE_MS];
  if (schedule.length === 0) throw new TypeError("Backoff schedule must contain a non-negative delay.");
  const nowMs = () => Number((options.now || Date.now)());
  const maxRetryAfterMs = Number.isFinite(options.maxRetryAfterMs) && options.maxRetryAfterMs >= 0
    ? options.maxRetryAfterMs
    : DEFAULT_MAX_RETRY_AFTER_MS;

  function requireUserId(userId) {
    if (typeof userId !== "string" || !userId) throw new TypeError("userId is required for session refresh backoff.");
  }

  function snapshot(userId, state = states.get(userId)) {
    if (!state) return null;
    const remainingMs = Math.max(0, state.nextEligibleAtMs - nowMs());
    return Object.freeze({
      attempt: state.attempt,
      lastFailureAt: state.lastFailureAt,
      nextEligibleAt: new Date(state.nextEligibleAtMs).toISOString(),
      nextEligibleAtMs: state.nextEligibleAtMs,
      reason: state.reason,
      retryAfterMs: remainingMs,
      status: state.status,
    });
  }

  function canAttempt(userId) {
    requireUserId(userId);
    const state = states.get(userId);
    if (!state) return Object.freeze({ allowed: true, attempt: 0, nextEligibleAt: null, reason: null, retryAfterMs: 0 });
    const current = snapshot(userId, state);
    return Object.freeze({
      allowed: current.retryAfterMs === 0,
      attempt: current.attempt,
      nextEligibleAt: current.nextEligibleAt,
      reason: current.reason,
      retryAfterMs: current.retryAfterMs,
    });
  }

  function recordFailure(userId, failure = {}) {
    requireUserId(userId);
    const classification = classifyRefreshFailure(failure);
    if (!classification.retryable) {
      return Object.freeze({ applied: false, classification, state: snapshot(userId) });
    }
    const current = states.get(userId);
    const attempt = (current?.attempt || 0) + 1;
    const scheduledDelay = schedule[Math.min(attempt - 1, schedule.length - 1)];
    const explicitRetryAfter = failure.retryAfterMs === undefined
      ? parseRetryAfterMs(failure.retryAfter ?? failure.retryAfterHeader, nowMs(), maxRetryAfterMs)
      : Math.min(Math.max(0, Number(failure.retryAfterMs) || 0), maxRetryAfterMs);
    const delayMs = Math.max(scheduledDelay, explicitRetryAfter || 0);
    const recordedAt = nowMs();
    states.set(userId, {
      attempt,
      lastFailureAt: new Date(recordedAt).toISOString(),
      nextEligibleAtMs: recordedAt + delayMs,
      reason: classification.reason,
      status: classification.status,
    });
    return Object.freeze({ applied: true, classification, delayMs, state: snapshot(userId) });
  }

  function reset(userId) {
    requireUserId(userId);
    return states.delete(userId);
  }

  return Object.freeze({
    canAttempt,
    clear() { states.clear(); },
    getDiagnostics() {
      return Object.freeze([...states.entries()].map(([userId, state]) => Object.freeze({
        ...snapshot(userId, state),
        userHash: safeUserHash(userId),
      })));
    },
    getState(userId) {
      requireUserId(userId);
      return snapshot(userId);
    },
    recordFailure,
    recordLogin: reset,
    recordSuccess: reset,
    reset,
    size() { return states.size; },
  });
}

module.exports = {
  DEFAULT_ABSOLUTE_USABILITY_SECONDS,
  DEFAULT_BACKOFF_SCHEDULE_MS,
  DEFAULT_MAX_RETRY_AFTER_MS,
  DEFAULT_REFRESH_THRESHOLD_SECONDS,
  classifyRefreshFailure,
  createProviderFingerprint,
  createSessionRefreshBackoff,
  evaluateAccessToken,
  evaluateProviderBinding,
  getProviderIdentity,
  normalizeProviderUrl,
  parseRetryAfterMs,
};
