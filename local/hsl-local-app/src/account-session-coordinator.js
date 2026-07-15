function createAccountSessionCoordinator(options = {}) {
  const inFlight = new Map();
  const states = new Map();
  const now = options.now || Date.now;

  function setState(userId, patch) {
    const previous = states.get(userId) || { generation: 0, sessionRevision: 0 };
    const next = {
      ...previous,
      ...patch,
      generation: previous.generation + 1,
      updatedAt: new Date(now()).toISOString(),
      userHash: options.hashUserId?.(userId) || null,
    };
    states.set(userId, next);
    return next;
  }

  function resolve(account, config, resolveOptions = {}) {
    const userId = account?.userId;
    if (!userId) return Promise.resolve({ status: "unavailable", storedSession: null });
    if (inFlight.has(userId)) return inFlight.get(userId);

    const promise = (async () => {
      setState(userId, { active: resolveOptions.active === true, status: "loading" });
      let remembered;
      try {
        remembered = await options.readSession(config, account);
      } catch (error) {
        const status = error?.code === "SESSION_STORAGE_CORRUPT" ? "corrupt" : "unavailable";
        setState(userId, { requiresLoginReason: status, status });
        return { error, status, storedSession: null };
      }
      if (!remembered?.ok || !remembered.session) {
        const status = remembered?.status === "invalid" ? "corrupt" : "unavailable";
        setState(userId, { requiresLoginReason: status, status });
        return { status, storedSession: null };
      }
      const storedSession = remembered.session;
      if (storedSession.user?.id !== userId) {
        setState(userId, { requiresLoginReason: "identity-mismatch", status: "revoked" });
        return { status: "revoked", storedSession: null };
      }
      const sessionRevision = Number(remembered.revision) || 0;
      if (!options.isExpiringSoon(storedSession) && resolveOptions.force !== true) {
        setState(userId, {
          accessTokenExpiresAt: storedSession.session?.expires_at || null,
          requiresLoginReason: null,
          sessionRevision,
          status: "valid",
          storage: remembered.storage,
        });
        return { remembered, sessionRevision, status: "valid", storedSession };
      }
      if (resolveOptions.connected !== true) {
        setState(userId, {
          accessTokenExpiresAt: storedSession.session?.expires_at || null,
          lastRefreshResult: "deferred-offline",
          requiresLoginReason: null,
          sessionRevision,
          status: "deferred-offline",
          storage: remembered.storage,
        });
        return { remembered, sessionRevision, status: "deferred-offline", storedSession };
      }

      setState(userId, { refreshInFlight: true, status: "refreshing" });
      try {
        const refreshed = await options.refreshSession({
          account,
          config,
          filePath: remembered.filePath,
          storedSession,
        });
        if (refreshed?.user?.id !== userId) {
          throw Object.assign(new Error("Identity mismatch"), { code: "SESSION_IDENTITY_MISMATCH", sessionStatus: "revoked" });
        }
        const reread = await options.readSession(config, account);
        const nextRevision = Number(reread.revision) || sessionRevision + 1;
        setState(userId, {
          accessTokenExpiresAt: refreshed.session?.expires_at || null,
          lastRefreshResult: "success",
          refreshInFlight: false,
          requiresLoginReason: null,
          sessionRevision: nextRevision,
          status: "valid",
          storage: reread.storage,
        });
        await options.onRefreshed?.(account, refreshed, nextRevision);
        return { remembered: reread, sessionRevision: nextRevision, status: "valid", storedSession: refreshed };
      } catch (error) {
        const conclusive = error?.sessionStatus === "revoked" || error?.code === "SESSION_IDENTITY_MISMATCH";
        const status = conclusive ? "revoked" : "deferred-offline";
        setState(userId, {
          lastRefreshResult: conclusive ? "revoked" : "temporary-failure",
          refreshInFlight: false,
          requiresLoginReason: conclusive ? (error.code || "refresh-token-rejected") : null,
          sessionRevision,
          status,
          storage: remembered.storage,
        });
        return { error, remembered, sessionRevision, status, storedSession: conclusive ? null : storedSession };
      }
    })().finally(() => inFlight.delete(userId));
    inFlight.set(userId, promise);
    return promise;
  }

  return {
    getDiagnostics() {
      return [...states.values()].map((state) => ({ ...state, storedSession: undefined }));
    },
    getState(userId) {
      const state = states.get(userId);
      return state ? { ...state, storedSession: undefined } : null;
    },
    hasInFlight(userId) { return inFlight.has(userId); },
    resolve,
    setPendingCount(userId, pendingCount) {
      if (!states.has(userId)) return null;
      return setState(userId, { pendingCount: Math.max(0, Number(pendingCount) || 0) });
    },
  };
}

module.exports = { createAccountSessionCoordinator };
