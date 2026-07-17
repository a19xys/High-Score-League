const { createHash } = require("node:crypto");

const RETRY_BACKOFF_MS = [30000, 60000, 120000, 300000, 900000];

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

function pendingAutoSubmitExecutionKey(context = {}) {
  return [pendingAutoSubmitGuardKey(context), context.connection?.reachabilityGeneration].join(":");
}

function diagnosticGuardKey(key) {
  return key ? `guard_${createHash("sha256").update(key).digest("hex").slice(0, 12)}` : null;
}

function createPendingAutoSubmitCoordinator(options = {}) {
  let chain = Promise.resolve();
  let terminalKey = null;
  let authBlockedKey = null;
  let cooldownKey = null;
  let nextEligibleAtMs = null;
  let retryAttempt = 0;
  let observedGuardKey = null;
  let lastExecutionGeneration = null;
  let epoch = 0;
  const nowMs = () => (options.now || Date.now)();
  const nowIso = () => new Date(nowMs()).toISOString();
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
    startedAt: null,
    status: "idle",
    trigger: null,
  };

  function clearGuards(reason) {
    terminalKey = null;
    authBlockedKey = null;
    cooldownKey = null;
    nextEligibleAtMs = null;
    retryAttempt = 0;
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
  }

  function observeGuard(context) {
    const guardKey = pendingAutoSubmitGuardKey(context);
    const executionGeneration = context.connection?.reachabilityGeneration ?? null;
    if (guardKey !== observedGuardKey) {
      observedGuardKey = guardKey;
      lastExecutionGeneration = executionGeneration;
      clearGuards("guard-key-change");
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
  }

  async function execute(trigger, requestEpoch) {
    diagnostics = { ...diagnostics, scheduledAt: nowIso(), status: "scheduled", trigger };
    const context = await options.inspect();
    if (requestEpoch !== epoch) {
      setDeferred("cancelled");
      return { attempted: false, deferReason: "cancelled", status: "cancelled", terminal: false };
    }
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

    if (requestEpoch !== epoch || result.status === "cancelled" || result.cancelled) {
      setDeferred("cancelled");
      await options.onResult?.({ ...result, status: "cancelled", terminal: false }, context);
      return { ...result, guardKey: safeGuardKey, status: "cancelled", terminal: false };
    }

    if (result.authFailure) {
      authBlockedKey = guardKey;
      setDeferred(result.reason || "auth-required", { authBlocked: true });
    } else if (result.retryable || result.transportFailure || result.status === "deferred") {
      const backoffMs = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
      retryAttempt += 1;
      const effectiveDelay = Math.max(backoffMs, Number(result.retryAfterMs) || 0);
      cooldownKey = guardKey;
      nextEligibleAtMs = nowMs() + effectiveDelay;
      setDeferred(result.reason || (result.transportFailure ? "transport" : "retryable"), {
        cooldownAttempt: retryAttempt,
        nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
      });
    } else if (result.terminal === true) {
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

  return {
    cancelCurrentRun(reason = "cancelled") {
      epoch += 1;
      diagnostics = {
        ...diagnostics,
        deferReason: reason,
        lastRunCancellationReason: reason,
        status: "cancelled",
      };
    },
    getDiagnostics: () => ({ ...diagnostics }),
    request(trigger = "unknown") {
      const requestEpoch = epoch;
      chain = chain.catch(() => {}).then(() => execute(trigger, requestEpoch));
      return chain;
    },
    resetGuards(reason = "explicit-reset") {
      clearGuards(reason);
    },
  };
}

module.exports = {
  RETRY_BACKOFF_MS,
  createPendingAutoSubmitCoordinator,
  derivePendingAutoSubmitReadiness,
  diagnosticGuardKey,
  pendingAutoSubmitExecutionKey,
  pendingAutoSubmitGuardKey,
};
