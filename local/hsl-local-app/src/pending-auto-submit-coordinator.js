const RETRY_BACKOFF_MS = [30000, 60000, 120000, 300000, 900000];

function derivePendingAutoSubmitReadiness(context = {}) {
  if (context.connection?.reachability !== "connected") return { ready: false, reason: "offline" };
  if (!context.userId) return { ready: false, reason: "no-active-account" };
  if (!context.session?.hasSession || context.session.userId !== context.userId) return { ready: false, reason: "session-not-ready" };
  if (!context.playerKey || !context.index) return { ready: false, reason: "queue-index-not-ready" };
  if (!context.webBaseUrl) return { ready: false, reason: "missing-web-base-url" };
  return { ready: true, reason: null };
}

function pendingAutoSubmitKey(context = {}) {
  return [context.userId, context.connection?.reachabilityGeneration, context.index?.revision, context.sessionRevision || 0].join(":");
}

function createPendingAutoSubmitCoordinator(options = {}) {
  let chain = Promise.resolve();
  let terminalKey = null;
  let authBlockedKey = null;
  let cooldownKey = null;
  let nextEligibleAtMs = null;
  let retryAttempt = 0;
  let observedKey = null;
  let epoch = 0;
  const nowMs = () => (options.now || Date.now)();
  const nowIso = () => new Date(nowMs()).toISOString();
  let diagnostics = {
    authBlocked: false,
    cooldownAttempt: 0,
    deferReason: null,
    finishedAt: null,
    lastTerminalKey: null,
    nextEligibleAt: null,
    readiness: "unknown",
    scheduledAt: null,
    startedAt: null,
    status: "idle",
    trigger: null,
  };

  function resetGuardsForKey(key) {
    if (key === observedKey) return;
    observedKey = key;
    authBlockedKey = null;
    cooldownKey = null;
    nextEligibleAtMs = null;
    retryAttempt = 0;
  }

  function setDeferred(reason, extra = {}) {
    diagnostics = {
      ...diagnostics,
      deferReason: reason,
      finishedAt: nowIso(),
      status: "deferred",
      ...extra,
    };
  }

  async function execute(trigger, requestEpoch, requestOptions = {}) {
    diagnostics = { ...diagnostics, scheduledAt: nowIso(), status: "scheduled", trigger };
    const context = await options.inspect();
    if (requestEpoch !== epoch) {
      setDeferred("invalidated");
      return { attempted: false, deferReason: "invalidated", status: "cancelled", terminal: false };
    }
    const readiness = derivePendingAutoSubmitReadiness(context);
    if (!readiness.ready) {
      setDeferred(readiness.reason, { readiness: readiness.reason });
      return { attempted: false, deferReason: readiness.reason, status: "deferred", terminal: false };
    }

    const key = pendingAutoSubmitKey(context);
    resetGuardsForKey(key);
    if (requestOptions.overrideCooldown === true) {
      authBlockedKey = null;
      cooldownKey = null;
      nextEligibleAtMs = null;
      retryAttempt = 0;
      terminalKey = terminalKey === key ? null : terminalKey;
    }
    if (key === terminalKey) return { attempted: false, key, reason: "already-completed", status: "completed", terminal: true };
    if (key === authBlockedKey) {
      setDeferred("auth-required", { authBlocked: true });
      return { attempted: false, authFailure: true, key, reason: "auth-required", status: "deferred", terminal: false };
    }
    if (key === cooldownKey && nextEligibleAtMs !== null && nowMs() < nextEligibleAtMs) {
      const retryAfterMs = nextEligibleAtMs - nowMs();
      setDeferred("cooldown", { nextEligibleAt: new Date(nextEligibleAtMs).toISOString() });
      return { attempted: false, key, reason: "cooldown", retryAfterMs, retryable: true, status: "deferred", terminal: false };
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
      ? await options.run({ ...context, key, trigger })
      : { attempted: false, reason: "no-pending", status: "completed", terminal: true };

    if (requestEpoch !== epoch || result.status === "cancelled" || result.cancelled) {
      setDeferred("invalidated");
      await options.onResult?.({ ...result, status: "cancelled", terminal: false }, context);
      return { ...result, key, status: "cancelled", terminal: false };
    }

    if (result.authFailure) {
      authBlockedKey = key;
      setDeferred(result.reason || "auth-required", { authBlocked: true });
    } else if (result.retryable || result.transportFailure || result.status === "deferred") {
      const backoffMs = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
      retryAttempt += 1;
      const effectiveDelay = Math.max(backoffMs, Number(result.retryAfterMs) || 0);
      cooldownKey = key;
      nextEligibleAtMs = nowMs() + effectiveDelay;
      setDeferred(result.reason || (result.transportFailure ? "transport" : "retryable"), {
        cooldownAttempt: retryAttempt,
        nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
      });
    } else if (result.terminal === true) {
      terminalKey = key;
      retryAttempt = 0;
      cooldownKey = null;
      nextEligibleAtMs = null;
      diagnostics = {
        ...diagnostics,
        deferReason: null,
        finishedAt: nowIso(),
        lastTerminalKey: terminalKey,
        nextEligibleAt: null,
        status: result.status === "attention-required" ? "attention-required" : "completed",
      };
    } else {
      setDeferred(result.reason || "non-terminal-result");
    }

    await options.onResult?.(result, context);
    return { ...result, key, status: diagnostics.status };
  }

  return {
    getDiagnostics: () => ({ ...diagnostics }),
    invalidate(reason = "invalidated") {
      epoch += 1;
      terminalKey = null;
      authBlockedKey = null;
      cooldownKey = null;
      nextEligibleAtMs = null;
      retryAttempt = 0;
      observedKey = null;
      diagnostics = { ...diagnostics, authBlocked: false, deferReason: reason, nextEligibleAt: null, status: "cancelled" };
    },
    request(trigger = "unknown", requestOptions = {}) {
      const requestEpoch = epoch;
      chain = chain.catch(() => {}).then(() => execute(trigger, requestEpoch, requestOptions));
      return chain;
    },
  };
}

module.exports = {
  RETRY_BACKOFF_MS,
  createPendingAutoSubmitCoordinator,
  derivePendingAutoSubmitReadiness,
  pendingAutoSubmitKey,
};
