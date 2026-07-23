const { createHash } = require("node:crypto");

const RETRY_BACKOFF_MS = [30000, 60000, 120000, 300000, 900000];
const SESSION_RETRY_FALLBACK_MS = 30000;
const SESSION_RETRY_FALLBACKS_MS = [30000, 60000, 120000, 300000, 900000];

function derivePendingAutoSubmitReadiness(context = {}) {
  if (context.connection?.reachability !== "connected") return { ready: false, reason: "offline" };
  if (!context.userId) return { ready: false, reason: "no-active-account" };
  if (!context.session?.hasSession || context.session.userId !== context.userId) return { ready: false, reason: "session-not-ready" };
  if (!context.playerKey || !context.index) return { ready: false, reason: "queue-index-not-ready" };
  if (!context.webBaseUrl) return { ready: false, reason: "missing-web-base-url" };
  return { ready: true, reason: null };
}

function pendingAutoSubmitGuardKey(context = {}) {
  return [context.userId, context.index?.revision, context.sessionRevision || 0].join(":");
}

function pendingAutoSubmitSessionKey(context = {}) {
  return [context.userId, context.sessionRevision || 0].join(":");
}

function pendingAutoSubmitExecutionKey(context = {}) {
  return [pendingAutoSubmitGuardKey(context), context.connection?.reachabilityGeneration].join(":");
}

function diagnosticGuardKey(key) {
  return key ? `guard_${createHash("sha256").update(key).digest("hex").slice(0, 12)}` : null;
}

function positiveDelay(value) {
  const delayMs = Number(value);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return null;
  return Math.min(Math.round(delayMs), 0x7fffffff);
}

function createPendingAutoSubmitCoordinator(options = {}) {
  let chain = Promise.resolve();
  let terminalKey = null;
  let authBlockedKey = null;
  let cooldownKey = null;
  let nextEligibleAtMs = null;
  let retryAttempt = 0;
  const sessionDeferrals = new Map();
  let sessionRetryTimer = null;
  let sessionRetryTimerAtMs = null;
  let observedGuardKey = null;
  let lastExecutionGeneration = null;
  let epoch = 0;
  let stopped = false;
  const nowMs = () => (options.now || Date.now)();
  const nowIso = () => new Date(nowMs()).toISOString();
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  let diagnostics = {
    authBlockPreservedAcrossConnectivity: false,
    authBlocked: false,
    cooldownAttempt: 0,
    cooldownPreservedAcrossConnectivity: false,
    deferReason: null,
    executionGeneration: null,
    finishedAt: null,
    guardKey: null,
    lastGuardResetReason: null,
    lastRunCancellationReason: null,
    lastTerminalKey: null,
    nextEligibleAt: null,
    readiness: "unknown",
    retryAttempt: 0,
    scheduledAt: null,
    sessionDeferred: false,
    sessionDeferralCount: 0,
    sessionNextEligibleAt: null,
    sessionRetryScheduled: false,
    startedAt: null,
    status: "idle",
    trigger: null,
  };

  function clearSessionRetryTimer() {
    if (sessionRetryTimer !== null) clearTimeoutImpl(sessionRetryTimer);
    sessionRetryTimer = null;
    sessionRetryTimerAtMs = null;
  }

  function earliestSessionDeadline() {
    let earliest = null;
    for (const deferral of sessionDeferrals.values()) {
      if (earliest === null || deferral.nextEligibleAtMs < earliest) earliest = deferral.nextEligibleAtMs;
    }
    return earliest;
  }

  function syncSessionDiagnostics(extra = {}) {
    const earliest = earliestSessionDeadline();
    diagnostics = {
      ...diagnostics,
      sessionDeferred: sessionDeferrals.size > 0,
      sessionDeferralCount: sessionDeferrals.size,
      sessionNextEligibleAt: earliest === null ? null : new Date(earliest).toISOString(),
      sessionRetryScheduled: sessionRetryTimer !== null,
      ...extra,
    };
  }

  function scheduleSessionRetry() {
    if (stopped || options.autoScheduleSessionRetry !== true || sessionDeferrals.size === 0) {
      clearSessionRetryTimer();
      syncSessionDiagnostics();
      return;
    }
    const expectedAtMs = earliestSessionDeadline();
    if (sessionRetryTimer !== null && sessionRetryTimerAtMs === expectedAtMs) return;
    clearSessionRetryTimer();
    sessionRetryTimerAtMs = expectedAtMs;
    sessionRetryTimer = setTimeoutImpl(() => {
      sessionRetryTimer = null;
      sessionRetryTimerAtMs = null;
      syncSessionDiagnostics();
      if (stopped || earliestSessionDeadline() !== expectedAtMs) {
        scheduleSessionRetry();
        return;
      }
      request("session-retry").catch(() => {});
    }, Math.max(0, expectedAtMs - nowMs()));
    sessionRetryTimer?.unref?.();
    syncSessionDiagnostics();
  }

  function fallbackDelay(attempt) {
    return SESSION_RETRY_FALLBACKS_MS[Math.min(attempt, SESSION_RETRY_FALLBACKS_MS.length - 1)];
  }

  function normalizeSessionDeferral(input, fallbackContext = {}) {
    const userId = input?.userId || fallbackContext.userId || null;
    if (!userId) return null;
    const sessionRevision = Number(input?.sessionRevision ?? fallbackContext.sessionRevision) || 0;
    return {
      pendingCount: Math.max(0, Number(input?.pendingCount) || 0),
      retryAfterMs: positiveDelay(input?.retryAfterMs),
      sessionRevision,
      userId,
    };
  }

  function armSessionDeferral(input, fallbackContext = {}) {
    const normalized = normalizeSessionDeferral(input, fallbackContext);
    if (!normalized) return null;
    const key = pendingAutoSubmitSessionKey(normalized);
    const previous = sessionDeferrals.get(key);
    const expired = previous && nowMs() >= previous.nextEligibleAtMs;
    if (previous && !expired) return previous;
    const fallbackAttempt = normalized.retryAfterMs === null
      ? (previous?.fallbackAttempt || 0) + 1
      : 0;
    const delayMs = normalized.retryAfterMs ?? fallbackDelay(Math.max(0, fallbackAttempt - 1));
    const next = {
      ...normalized,
      fallbackAttempt,
      key,
      nextEligibleAtMs: nowMs() + delayMs,
    };
    sessionDeferrals.set(key, next);
    syncSessionDiagnostics();
    return next;
  }

  function clearSessionDeferralFor(context = {}) {
    const key = pendingAutoSubmitSessionKey(context);
    const removed = sessionDeferrals.delete(key);
    if (removed) {
      syncSessionDiagnostics();
      scheduleSessionRetry();
    }
  }

  function reconcileSessionDeferrals(context = {}) {
    const identities = Array.isArray(context.sessionIdentities)
      ? context.sessionIdentities
      : context.userId && context.userId !== "remembered-accounts"
        ? [{ userId: context.userId, sessionRevision: context.sessionRevision }]
        : [];
    const observedUsers = new Map(identities.map((identity) => [
      identity.userId,
      Number(identity.sessionRevision) || 0,
    ]));
    for (const [key, deferral] of sessionDeferrals) {
      if (!observedUsers.has(deferral.userId) || observedUsers.get(deferral.userId) !== deferral.sessionRevision) {
        sessionDeferrals.delete(key);
      }
    }

    const hasReportedDeferrals = Array.isArray(context.sessionDeferrals);
    const reported = hasReportedDeferrals ? context.sessionDeferrals : [];
    const reportedKeys = new Set();
    for (const item of reported) {
      const normalized = normalizeSessionDeferral(item);
      if (!normalized) continue;
      const key = pendingAutoSubmitSessionKey(normalized);
      reportedKeys.add(key);
      armSessionDeferral(normalized);
    }

    if (hasReportedDeferrals) {
      for (const identity of identities) {
        const key = pendingAutoSubmitSessionKey(identity);
        if (!reportedKeys.has(key) && sessionDeferrals.has(key)) {
          sessionDeferrals.delete(key);
        }
      }
    }
    syncSessionDiagnostics();
    scheduleSessionRetry();
  }

  function clearGuards(reason) {
    clearSessionRetryTimer();
    terminalKey = null;
    authBlockedKey = null;
    cooldownKey = null;
    nextEligibleAtMs = null;
    retryAttempt = 0;
    sessionDeferrals.clear();
    diagnostics = {
      ...diagnostics,
      authBlockPreservedAcrossConnectivity: false,
      authBlocked: false,
      cooldownAttempt: 0,
      cooldownPreservedAcrossConnectivity: false,
      lastGuardResetReason: reason,
      lastTerminalKey: null,
      nextEligibleAt: null,
      retryAttempt: 0,
    };
    syncSessionDiagnostics();
  }

  function observeGuard(context) {
    const guardKey = pendingAutoSubmitGuardKey(context);
    const executionGeneration = context.connection?.reachabilityGeneration ?? null;
    if (guardKey !== observedGuardKey) {
      observedGuardKey = guardKey;
      lastExecutionGeneration = executionGeneration;
    } else if (executionGeneration !== lastExecutionGeneration) {
      diagnostics = {
        ...diagnostics,
        authBlockPreservedAcrossConnectivity: authBlockedKey === guardKey,
        cooldownPreservedAcrossConnectivity: cooldownKey === guardKey && nextEligibleAtMs !== null,
      };
      lastExecutionGeneration = executionGeneration;
    }
    diagnostics = {
      ...diagnostics,
      executionGeneration,
      guardKey: diagnosticGuardKey(guardKey),
    };
    return guardKey;
  }

  function setDeferred(reason, extra = {}) {
    diagnostics = {
      ...diagnostics,
      deferReason: reason,
      finishedAt: nowIso(),
      retryAttempt,
      status: "deferred",
      ...extra,
    };
    syncSessionDiagnostics();
  }

  function sessionWaitResult(context, safeGuardKey) {
    const key = pendingAutoSubmitSessionKey(context);
    const deferral = sessionDeferrals.get(key);
    if (!deferral || nowMs() >= deferral.nextEligibleAtMs) return null;
    const retryAfterMs = deferral.nextEligibleAtMs - nowMs();
    setDeferred("session-refresh-wait", {
      authBlocked: false,
      sessionDeferred: true,
    });
    scheduleSessionRetry();
    return {
      attempted: false,
      guardKey: safeGuardKey,
      reason: "session-refresh-wait",
      retryAfterMs,
      sessionDeferred: true,
      status: "deferred",
      terminal: false,
    };
  }

  async function execute(trigger, requestEpoch) {
    if (stopped) return { attempted: false, reason: "shutdown", status: "cancelled", terminal: false };
    diagnostics = { ...diagnostics, scheduledAt: nowIso(), status: "scheduled", trigger };
    const context = await options.inspect();
    if (requestEpoch !== epoch || stopped) {
      setDeferred("cancelled");
      return { attempted: false, deferReason: "cancelled", status: "cancelled", terminal: false };
    }
    reconcileSessionDeferrals(context);
    const readiness = derivePendingAutoSubmitReadiness(context);
    if (!readiness.ready) {
      setDeferred(readiness.reason, { readiness: readiness.reason });
      return { attempted: false, deferReason: readiness.reason, status: "deferred", terminal: false };
    }

    const guardKey = observeGuard(context);
    const safeGuardKey = diagnosticGuardKey(guardKey);
    if (guardKey === terminalKey) return { attempted: false, guardKey: safeGuardKey, reason: "already-completed", status: "completed", terminal: true };
    if (guardKey === authBlockedKey) {
      setDeferred("auth-required", { authBlocked: true });
      return { attempted: false, authFailure: true, guardKey: safeGuardKey, reason: "auth-required", status: "deferred", terminal: false };
    }
    if (guardKey === cooldownKey && nextEligibleAtMs !== null && nowMs() < nextEligibleAtMs) {
      const retryAfterMs = nextEligibleAtMs - nowMs();
      setDeferred("cooldown", { nextEligibleAt: new Date(nextEligibleAtMs).toISOString() });
      return { attempted: false, guardKey: safeGuardKey, reason: "cooldown", retryAfterMs, retryable: true, status: "deferred", terminal: false };
    }

    const directWait = sessionWaitResult(context, safeGuardKey);
    if (directWait) return directWait;
    if (context.userId === "remembered-accounts" && context.index?.totals?.pending > 0 &&
        Array.isArray(context.accountContexts) && context.accountContexts.length === 0 && sessionDeferrals.size > 0) {
      const retryAfterMs = Math.max(0, earliestSessionDeadline() - nowMs());
      setDeferred("session-refresh-wait", { authBlocked: false, sessionDeferred: true });
      scheduleSessionRetry();
      return { attempted: false, guardKey: safeGuardKey, reason: "session-refresh-wait", retryAfterMs, sessionDeferred: true, status: "deferred", terminal: false };
    }

    diagnostics = {
      ...diagnostics,
      authBlocked: false,
      connectivityGeneration: context.connection.reachabilityGeneration,
      deferReason: null,
      queueRevision: context.index.revision,
      readiness: "ready",
      sessionRevision: context.sessionRevision || 0,
      startedAt: nowIso(),
      status: "running",
    };
    const result = context.index.totals.pending > 0
      ? await options.run({ ...context, guardKey: safeGuardKey, trigger })
      : { attempted: false, reason: "no-pending", status: "completed", terminal: true };

    if (requestEpoch !== epoch || result.status === "cancelled" || result.cancelled || stopped) {
      setDeferred("cancelled");
      await options.onResult?.({ ...result, status: "cancelled", terminal: false }, context);
      return { ...result, guardKey: safeGuardKey, status: "cancelled", terminal: false };
    }

    if (result.authFailure) {
      authBlockedKey = guardKey;
      setDeferred(result.reason || "auth-required", { authBlocked: true });
    } else if (result.retryable || result.transportFailure || (result.status === "deferred" && !result.sessionDeferred)) {
      const backoffMs = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
      retryAttempt += 1;
      const effectiveDelay = Math.max(backoffMs, Number(result.retryAfterMs) || 0);
      cooldownKey = guardKey;
      nextEligibleAtMs = nowMs() + effectiveDelay;
      setDeferred(result.reason || (result.transportFailure ? "transport" : "retryable"), {
        cooldownAttempt: retryAttempt,
        nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
      });
    } else if (result.sessionDeferred) {
      const reported = Array.isArray(result.sessionDeferrals) && result.sessionDeferrals.length > 0
        ? result.sessionDeferrals
        : Array.isArray(context.sessionDeferrals) && context.sessionDeferrals.length > 0
          ? context.sessionDeferrals
          : [result];
      for (const item of reported) armSessionDeferral(item, context);
      setDeferred(result.reason || "session-deferred", { authBlocked: false, sessionDeferred: true });
      scheduleSessionRetry();
    } else if (result.terminal === true) {
      clearSessionDeferralFor(context);
      terminalKey = guardKey;
      retryAttempt = 0;
      cooldownKey = null;
      nextEligibleAtMs = null;
      diagnostics = {
        ...diagnostics,
        cooldownAttempt: 0,
        deferReason: null,
        finishedAt: nowIso(),
        lastTerminalKey: safeGuardKey,
        nextEligibleAt: null,
        retryAttempt: 0,
        status: result.status === "attention-required" ? "attention-required" : "completed",
      };
    } else {
      setDeferred(result.reason || "non-terminal-result");
    }

    await options.onResult?.(result, context);
    return { ...result, guardKey: safeGuardKey, status: diagnostics.status };
  }

  function request(trigger = "unknown") {
    if (stopped) return Promise.resolve({ attempted: false, reason: "shutdown", status: "cancelled", terminal: false });
    const requestEpoch = epoch;
    chain = chain.catch(() => {}).then(() => execute(trigger, requestEpoch));
    return chain;
  }

  return {
    cancelCurrentRun(reason = "cancelled") {
      epoch += 1;
      clearSessionRetryTimer();
      diagnostics = {
        ...diagnostics,
        deferReason: reason,
        lastRunCancellationReason: reason,
        sessionRetryScheduled: false,
        status: "cancelled",
      };
    },
    getDiagnostics: () => ({ ...diagnostics }),
    request,
    resetGuards(reason = "explicit-reset") {
      clearGuards(reason);
    },
    resume(reason = "resume") {
      if (stopped) return Promise.resolve({ attempted: false, reason: "shutdown", status: "cancelled", terminal: false });
      scheduleSessionRetry();
      return request(reason);
    },
    shutdown(reason = "shutdown") {
      stopped = true;
      epoch += 1;
      clearSessionRetryTimer();
      sessionDeferrals.clear();
      syncSessionDiagnostics({ deferReason: reason, status: "cancelled" });
    },
  };
}

module.exports = {
  RETRY_BACKOFF_MS,
  SESSION_RETRY_FALLBACK_MS,
  SESSION_RETRY_FALLBACKS_MS,
  createPendingAutoSubmitCoordinator,
  derivePendingAutoSubmitReadiness,
  diagnosticGuardKey,
  pendingAutoSubmitExecutionKey,
  pendingAutoSubmitGuardKey,
  pendingAutoSubmitSessionKey,
};
