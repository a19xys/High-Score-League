const { readKnownAccounts } = require("./account-store");
const { resolveCanonicalSessionResult } = require("./auth");
const { postPlayTimeEvent } = require("./playtime-http");
const { createPlayTimeStore } = require("./playtime-store");
const { derivePlayerKey } = require("./scoped-queue");
const { isSessionRemoteUsable } = require("./session-result");

function createPlayTimeSyncService(options = {}) {
  const configProvider = options.configProvider || (() => options.config || {});
  const readAccounts = options.readKnownAccountsImpl || readKnownAccounts;
  const resolveSession = options.resolveSessionResultImpl || resolveCanonicalSessionResult;
  const createStore = options.createStoreImpl || createPlayTimeStore;
  const postEvent = options.postEventImpl || postPlayTimeEvent;
  const getConnectivityState = options.getConnectivityState || (() => ({ reachability: "offline" }));
  const now = options.now || Date.now;
  const diagnostics = {
    acknowledged: 0,
    cancelled: 0,
    failedTerminal: 0,
    lastRunAt: null,
    lastTrigger: null,
    pendingVisited: 0,
    preserved: 0,
    skippedAccounts: 0,
    skippedBackoff: 0,
    skippedOffline: 0,
  };
  let active = null;
  let epoch = 0;
  let queuedTrigger = null;
  let retryNotBefore = 0;

  async function run(trigger, owner) {
    diagnostics.lastRunAt = new Date(now()).toISOString();
    diagnostics.lastTrigger = trigger;
    if (getConnectivityState()?.reachability !== "connected") {
      diagnostics.skippedOffline += 1;
      return { attempted: false, reason: "offline" };
    }
    if (now() < retryNotBefore) {
      diagnostics.skippedBackoff += 1;
      return { attempted: false, reason: "backoff" };
    }
    const config = configProvider();
    const accounts = await readAccounts(config);
    const result = { acknowledged: 0, attempted: true, failedTerminal: 0, preserved: 0, visited: 0 };
    let stopRun = false;
    for (const account of accounts.accounts || []) {
      if (owner.controller.signal.aborted || owner.runId !== epoch) break;
      const playerKey = derivePlayerKey({ hasSession: true, userId: account.userId });
      const store = createStore(config, playerKey);
      const pending = await store.listPending();
      if (pending.length === 0) continue;
      const sessionResult = await resolveSession(config, {
        connected: true,
        signal: owner.controller.signal,
        userId: account.userId,
      });
      const accessToken = sessionResult.storedSession?.session?.access_token;
      if (!accessToken || !isSessionRemoteUsable(sessionResult)) {
        diagnostics.skippedAccounts += 1;
        diagnostics.preserved += pending.length;
        result.preserved += pending.length;
        continue;
      }
      for (const event of pending) {
        if (owner.controller.signal.aborted || owner.runId !== epoch) break;
        diagnostics.pendingVisited += 1;
        result.visited += 1;
        const remote = await postEvent({
          accessToken,
          event,
          fetchImpl: options.fetchImpl,
          signal: owner.controller.signal,
          webBaseUrl: config.webBaseUrl || config.hslOrigin,
        });
        if (owner.controller.signal.aborted || owner.runId !== epoch) {
          stopRun = true;
          break;
        }
        if (remote.ok) {
          await store.acknowledge(event.eventId);
          diagnostics.acknowledged += 1;
          result.acknowledged += 1;
          continue;
        }
        if (remote.terminal) {
          await store.reject(event.eventId, `http-${remote.httpStatus || "domain"}`);
          diagnostics.failedTerminal += 1;
          result.failedTerminal += 1;
          continue;
        }
        const delay = Number(remote.retryAfterMs);
        if (Number.isFinite(delay) && delay > 0) retryNotBefore = Math.max(retryNotBefore, now() + delay);
        diagnostics.preserved += 1;
        result.preserved += 1;
        if (["transport-failure", "timeout", "throttled", "server"].includes(remote.failureType)) {
          stopRun = true;
          break;
        }
        if (remote.failureType === "auth") break;
      }
      if (stopRun) break;
    }
    return result;
  }

  function request(trigger = "unknown") {
    if (active?.promise) {
      if (active.controller.signal.aborted) queuedTrigger = trigger;
      return active.promise;
    }
    const owner = { controller: new AbortController(), promise: null, runId: ++epoch };
    active = owner;
    owner.promise = Promise.resolve().then(() => run(trigger, owner)).catch((error) => {
      if (owner.controller.signal.aborted || error?.name === "AbortError") {
        diagnostics.cancelled += 1;
        return { attempted: true, cancelled: true };
      }
      options.logger?.warn?.("playtime-sync", { reason: error?.code || error?.name || "Error" });
      return { attempted: true, failed: true, reason: error?.code || "sync-failed" };
    }).finally(() => {
      if (active === owner) active = null;
      if (queuedTrigger) {
        const nextTrigger = queuedTrigger;
        queuedTrigger = null;
        queueMicrotask(() => request(nextTrigger));
      }
    });
    return owner.promise;
  }

  function cancel(reason = "external-abort") {
    epoch += 1;
    active?.controller.abort(reason);
  }

  return {
    cancel,
    getDiagnostics: () => ({ ...diagnostics, inFlight: Boolean(active), retryNotBefore: retryNotBefore || null }),
    request,
    shutdown: () => {
      queuedTrigger = null;
      cancel("shutdown");
    },
  };
}

module.exports = { createPlayTimeSyncService };
