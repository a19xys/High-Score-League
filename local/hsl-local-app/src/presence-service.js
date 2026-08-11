const { executeCanonicalAuthenticatedRequest } = require("./authenticated-request");
const { resolveCanonicalSessionResult } = require("./auth");
const { getOrCreatePresenceClientId } = require("./presence-client-id");
const { requestLauncherPresence } = require("./presence-http");

const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;

function connectedActivity() {
  return { activity: "connected", mode: null, weekId: null };
}

function createPresenceService(options = {}) {
  const configProvider = options.configProvider || (() => options.config || {});
  const resolveSession = options.resolveSessionResultImpl || resolveCanonicalSessionResult;
  const requestPresence = options.requestPresenceImpl || requestLauncherPresence;
  const getClientId = options.getClientIdImpl || getOrCreatePresenceClientId;
  const setTimeoutImpl = options.setTimeout || setTimeout;
  const clearTimeoutImpl = options.clearTimeout || clearTimeout;
  const getConnectivityState = options.getConnectivityState || (() => ({ reachability: "offline" }));
  let activeUserId = null;
  let desiredUserId = null;
  let activity = connectedActivity();
  let clientId = null;
  let started = false;
  let suspended = false;
  let disposed = false;
  let timer = null;
  let requestGeneration = 0;
  let stateGeneration = 0;
  let activeRequest = null;
  let accountTransition = Promise.resolve();
  let lastClearedUserId = null;

  const diagnostics = {
    clears: 0,
    deferred: 0,
    failed: 0,
    heartbeats: 0,
    lastActivity: "connected",
    lastTrigger: null,
  };

  function online() {
    return getConnectivityState()?.reachability === "connected";
  }

  function clearTimer() {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!started || disposed || suspended) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      request("heartbeat").catch(() => {});
      schedule();
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    timer?.unref?.();
  }

  async function authenticatedRequest({ method, payload, userId, signal }) {
    const config = configProvider();
    return executeCanonicalAuthenticatedRequest({
      execute: ({ accessToken }) => requestPresence({
        accessToken,
        fetchImpl: options.fetchImpl,
        method,
        payload,
        signal,
        webBaseUrl: config.webBaseUrl || config.hslOrigin,
      }),
      resolveSession: ({ force }) => resolveSession(config, {
        connected: true,
        force,
        signal,
        userId,
      }),
    });
  }

  async function clearRemote(userId, reason = "account-change") {
    if (!userId || !clientId || !online()) return { attempted: false, reason: "unavailable" };
    const controller = new AbortController();
    const result = await authenticatedRequest({
      method: "DELETE",
      payload: { version: 1, clientId },
      signal: controller.signal,
      userId,
    });
    if (result.status === "response" && result.requestResult?.ok) diagnostics.clears += 1;
    diagnostics.lastTrigger = reason;
    return result;
  }

  function clearCurrent(reason = "account-change") {
    const userId = activeUserId;
    if (!userId) return Promise.resolve({ attempted: false, reason: "no-active-account" });
    desiredUserId = null;
    activity = connectedActivity();
    diagnostics.lastActivity = activity.activity;
    stateGeneration += 1;
    requestGeneration += 1;
    accountTransition = accountTransition.catch(() => {}).then(async () => {
      const result = await clearRemote(userId, reason).catch(() => ({ attempted: true, failed: true }));
      lastClearedUserId = userId;
      if (desiredUserId === null && activeUserId === userId) activeUserId = null;
      return result;
    });
    return accountTransition;
  }

  async function performRequest(trigger, generation, userId, snapshot) {
    if (!started || disposed || suspended || !online() || !userId || userId !== desiredUserId || !clientId) {
      diagnostics.deferred += 1;
      return { attempted: false, reason: "unavailable" };
    }
    const requestId = ++requestGeneration;
    const controller = new AbortController();
    const result = await authenticatedRequest({
      method: "POST",
      payload: { version: 1, clientId, ...snapshot },
      signal: controller.signal,
      userId,
    });
    if (requestId !== requestGeneration || userId !== activeUserId || userId !== desiredUserId) {
      return { attempted: true, stale: true };
    }
    diagnostics.lastTrigger = trigger;
    if (result.status === "response" && result.requestResult?.ok) diagnostics.heartbeats += 1;
    else if (["deferred", "requires-login"].includes(result.status)) diagnostics.deferred += 1;
    else diagnostics.failed += 1;
    return result;
  }

  function request(trigger = "manual") {
    if (activeRequest) return activeRequest;
    const generation = stateGeneration;
    const userId = activeUserId;
    const snapshot = { ...activity };
    activeRequest = performRequest(trigger, generation, userId, snapshot)
      .catch(() => {
        diagnostics.failed += 1;
        return { attempted: true, failed: true };
      })
      .finally(() => {
        activeRequest = null;
        if (!disposed && stateGeneration !== generation) queueMicrotask(() => request("state-changed").catch(() => {}));
      });
    return activeRequest;
  }

  function setActiveUserId(userId) {
    const nextUserId = typeof userId === "string" && userId ? userId : null;
    if (nextUserId === desiredUserId) return accountTransition;
    desiredUserId = nextUserId;
    activity = connectedActivity();
    diagnostics.lastActivity = activity.activity;
    stateGeneration += 1;
    requestGeneration += 1;
    accountTransition = accountTransition.catch(() => {}).then(async () => {
      const previousUserId = activeUserId;
      if (previousUserId && previousUserId !== desiredUserId && previousUserId !== lastClearedUserId) {
        await clearRemote(previousUserId, "account-change").catch(() => {});
      }
      lastClearedUserId = null;
      if (disposed) return;
      activeUserId = desiredUserId;
      stateGeneration += 1;
      if (activeUserId) await request("account-change");
    });
    return accountTransition;
  }

  function setActivity(next, expectedUserId = activeUserId) {
    if (!expectedUserId || expectedUserId !== activeUserId || expectedUserId !== desiredUserId) {
      return Promise.resolve({ attempted: false, reason: "inactive-account" });
    }
    const normalized = next?.activity === "playing"
      ? {
          activity: "playing",
          mode: next.mode === "competition" ? "competition" : "practice",
          weekId: typeof next.weekId === "string" && next.weekId ? next.weekId : null,
        }
      : connectedActivity();
    if (JSON.stringify(normalized) === JSON.stringify(activity)) return Promise.resolve({ attempted: false, reason: "unchanged" });
    activity = normalized;
    diagnostics.lastActivity = activity.activity;
    stateGeneration += 1;
    return request(`activity-${activity.activity}`);
  }

  function setOnline(value, trigger = "connectivity-change") {
    if (value === true) return request(trigger);
    requestGeneration += 1;
    return Promise.resolve({ attempted: false, reason: "offline" });
  }

  function setSuspended(value) {
    suspended = value === true;
    if (suspended) {
      clearTimer();
      requestGeneration += 1;
      return Promise.resolve({ attempted: false, reason: "suspended" });
    }
    schedule();
    return request("resume");
  }

  async function start() {
    if (started || disposed) return;
    clientId = await getClientId(configProvider(), { logger: options.logger });
    if (disposed) return;
    started = true;
    schedule();
    await request("startup");
  }

  async function shutdown() {
    if (disposed) return;
    clearTimer();
    await accountTransition.catch(() => {});
    if (activeUserId !== lastClearedUserId) await clearRemote(activeUserId, "shutdown").catch(() => {});
    disposed = true;
    started = false;
    activeUserId = null;
    desiredUserId = null;
    requestGeneration += 1;
  }

  function createMameLifecycle(context = {}) {
    const userId = context.userId || activeUserId;
    const mode = context.mode;
    const weekId = context.weekId || null;
    let spawned = false;
    return {
      async onSpawn() {
        if (spawned) return;
        spawned = true;
        await setActivity({ activity: "playing", mode, weekId }, userId);
      },
      async onClose() {
        if (!spawned) return;
        await setActivity(connectedActivity(), userId);
      },
    };
  }

  return {
    clearCurrent,
    createMameLifecycle,
    getDiagnostics: () => ({
      ...diagnostics,
      activeAccount: Boolean(activeUserId),
      clientIdReady: Boolean(clientId),
      inFlight: Boolean(activeRequest),
      intervalMs: PRESENCE_HEARTBEAT_INTERVAL_MS,
      online: online(),
      running: started && !disposed,
      suspended,
    }),
    request,
    setActiveUserId,
    setActivity,
    setOnline,
    setSuspended,
    shutdown,
    start,
  };
}

module.exports = {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  connectedActivity,
  createPresenceService,
};
