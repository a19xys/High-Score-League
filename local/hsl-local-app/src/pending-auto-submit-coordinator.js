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
  let epoch = 0;
  let diagnostics = {
    deferReason: null,
    finishedAt: null,
    lastTerminalKey: null,
    readiness: "unknown",
    scheduledAt: null,
    startedAt: null,
    status: "idle",
    trigger: null,
  };
  const now = () => new Date((options.now || Date.now)()).toISOString();

  async function execute(trigger, requestEpoch) {
    diagnostics = { ...diagnostics, scheduledAt: now(), status: "scheduled", trigger };
    const context = await options.inspect();
    if (requestEpoch !== epoch) return { attempted: false, deferReason: "invalidated", status: "cancelled" };
    const readiness = derivePendingAutoSubmitReadiness(context);
    if (!readiness.ready) {
      diagnostics = { ...diagnostics, deferReason: readiness.reason, readiness: readiness.reason, status: "deferred" };
      return { attempted: false, deferReason: readiness.reason, status: "deferred" };
    }
    const key = pendingAutoSubmitKey(context);
    if (key === terminalKey) return { attempted: false, key, reason: "already-completed", status: "completed" };
    diagnostics = {
      ...diagnostics,
      connectivityGeneration: context.connection.reachabilityGeneration,
      deferReason: null,
      queueRevision: context.index.revision,
      sessionRevision: context.sessionRevision || 0,
      readiness: "ready",
      startedAt: now(),
      status: "running",
    };
    const result = context.index.totals.pending > 0
      ? await options.run({ ...context, key, trigger })
      : { attempted: false, reason: "no-pending", status: "completed" };
    const deferred = result.transportFailure || result.authFailure || result.reason === "sync-in-progress" || result.status === "deferred";
    if (!deferred && requestEpoch === epoch) terminalKey = key;
    diagnostics = {
      ...diagnostics,
      deferReason: deferred ? (result.reason || (result.transportFailure ? "transport" : "auth")) : null,
      finishedAt: now(),
      lastTerminalKey: terminalKey,
      status: deferred ? "deferred" : "completed",
    };
    await options.onResult?.(result, context);
    return { ...result, key, status: diagnostics.status };
  }

  return {
    getDiagnostics: () => ({ ...diagnostics }),
    invalidate(reason = "invalidated") {
      epoch += 1;
      terminalKey = null;
      diagnostics = { ...diagnostics, deferReason: reason, status: "cancelled" };
    },
    request(trigger = "unknown") {
      const requestEpoch = epoch;
      chain = chain.catch(() => {}).then(() => execute(trigger, requestEpoch));
      return chain;
    },
  };
}

module.exports = {
  createPendingAutoSubmitCoordinator,
  derivePendingAutoSubmitReadiness,
  pendingAutoSubmitKey,
};
