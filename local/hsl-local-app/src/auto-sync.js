const ELIGIBLE_STATUS = "member";

const BLOCK_MESSAGES = {
  no_session: "No se puede sincronizar: inicia sesion.",
  not_member: "No se puede sincronizar: no participas en esta temporada.",
  unauthenticated: "No se puede sincronizar: la sesion no es valida.",
  missing_week: "No se puede sincronizar: el pack no tiene weekId.",
  invalid_week: "No se puede sincronizar: semana no valida.",
  error: "No se puede sincronizar: no se pudo comprobar la temporada.",
  unknown: "No se puede sincronizar: no se pudo comprobar la temporada.",
};

function emptyAutoSyncState(overrides = {}) {
  return {
    failedCount: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    message: "Sincronizacion automatica lista.",
    pendingAfter: null,
    pendingBefore: null,
    reason: null,
    sentCount: null,
    status: "idle",
    ...overrides,
  };
}

function getPendingCount(queue) {
  return queue?.totals?.pending || 0;
}

function getFailedCount(queue) {
  return queue?.totals?.failed || 0;
}

function getAutoSyncBlockReason(context = {}) {
  if (context.busy || context.autoSyncInProgress) {
    return {
      message: "Sincronizacion automatica ya en curso.",
      reason: "sync_in_progress",
      status: "blocked",
    };
  }

  if (!context.session?.hasSession) {
    return {
      message: BLOCK_MESSAGES.no_session,
      reason: "no_session",
      status: "blocked",
    };
  }

  if (!context.scope) {
    return {
      message: "No se puede sincronizar: no hay cola de cuenta y pack.",
      reason: "missing_scope",
      status: "blocked",
    };
  }

  const membershipStatus = context.membership?.status || "unknown";

  if (membershipStatus !== ELIGIBLE_STATUS || context.membership?.canSubmit !== true) {
    return {
      message: BLOCK_MESSAGES[membershipStatus] || BLOCK_MESSAGES.unknown,
      reason: membershipStatus,
      status: "blocked",
    };
  }

  if (getPendingCount(context.queue) <= 0) {
    return {
      message: "No hay puntuaciones pendientes para sincronizar.",
      reason: "no_pending",
      status: "not_eligible",
    };
  }

  return null;
}

function shouldAutoSync(context = {}) {
  return getAutoSyncBlockReason(context) === null;
}

function summarizeAutoSyncAttempt({ beforeQueue, afterQueue, now, ok }) {
  const pendingBefore = getPendingCount(beforeQueue);
  const pendingAfter = getPendingCount(afterQueue);
  const failedBefore = getFailedCount(beforeQueue);
  const failedAfter = getFailedCount(afterQueue);
  const sentBefore = beforeQueue?.totals?.sent || 0;
  const sentAfter = afterQueue?.totals?.sent || 0;
  const failedCount = Math.max(0, failedAfter - failedBefore);
  const sentCount = Math.max(0, sentAfter - sentBefore);

  if (failedAfter > failedBefore || failedCount > 0) {
    return emptyAutoSyncState({
      failedCount,
      lastAttemptAt: now,
      message: "Algunas puntuaciones requieren atencion.",
      pendingAfter,
      pendingBefore,
      reason: "failed_items",
      sentCount,
      status: "partial_failed",
    });
  }

  if (ok && pendingAfter === 0) {
    return emptyAutoSyncState({
      failedCount,
      lastAttemptAt: now,
      lastSuccessAt: now,
      message: "Puntuaciones sincronizadas.",
      pendingAfter,
      pendingBefore,
      sentCount,
      status: "synced",
    });
  }

  return emptyAutoSyncState({
    failedCount,
    lastAttemptAt: now,
    message: "No se pudo sincronizar automaticamente. Las puntuaciones siguen guardadas localmente.",
    pendingAfter,
    pendingBefore,
    reason: "submit_failed",
    sentCount,
    status: "failed",
  });
}

function getAutoSyncDisplayState(context = {}, runtimeState = emptyAutoSyncState()) {
  if (context.autoSyncInProgress || runtimeState.status === "syncing") {
    return {
      ...runtimeState,
      message: "Subiendo puntuaciones pendientes...",
      status: "syncing",
    };
  }

  const pending = getPendingCount(context.queue);
  const failed = getFailedCount(context.queue);

  if (pending > 0) {
    const block = getAutoSyncBlockReason(context);

    if (block) {
      return emptyAutoSyncState({
        lastAttemptAt: runtimeState.lastAttemptAt,
        lastSuccessAt: runtimeState.lastSuccessAt,
        message: block.message,
        pendingAfter: pending,
        reason: block.reason,
        status: block.status,
      });
    }

    return emptyAutoSyncState({
      lastAttemptAt: runtimeState.lastAttemptAt,
      lastSuccessAt: runtimeState.lastSuccessAt,
      message: "Sincronizacion automatica lista.",
      pendingAfter: pending,
      reason: null,
      status: "idle",
    });
  }

  if (failed > 0 && runtimeState.status === "partial_failed") {
    return runtimeState;
  }

  if (failed > 0) {
    return emptyAutoSyncState({
      failedCount: failed,
      lastAttemptAt: runtimeState.lastAttemptAt,
      lastSuccessAt: runtimeState.lastSuccessAt,
      message: "Algunas puntuaciones requieren atencion.",
      reason: "failed_items",
      status: "partial_failed",
    });
  }

  if (runtimeState.status === "synced") {
    return runtimeState;
  }

  return emptyAutoSyncState({
    lastAttemptAt: runtimeState.lastAttemptAt,
    lastSuccessAt: runtimeState.lastSuccessAt,
    message: "Sincronizacion automatica lista.",
    status: "idle",
  });
}

module.exports = {
  emptyAutoSyncState,
  getAutoSyncBlockReason,
  getAutoSyncDisplayState,
  shouldAutoSync,
  summarizeAutoSyncAttempt,
};
