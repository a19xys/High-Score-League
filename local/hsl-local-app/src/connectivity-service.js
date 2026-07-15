const {
  deriveConnectivityDisplayState,
  isStableConnected,
} = require("./connectivity-state");
const {
  SUPPORTED_LAUNCHER_API_VERSION,
  deploymentKey,
  readHealthDeployment,
} = require("./deployment-fingerprint");

const HEALTH_PATH = "/api/launcher/health";
const DEFAULT_CONNECTIVITY_OPTIONS = Object.freeze({
  connectedActiveIntervalMs: 45 * 1000,
  connectedBackgroundIntervalMs: 4 * 60 * 1000,
  focusStaleMs: 90 * 1000,
  healthTimeoutMs: 3 * 1000,
  jitterRatio: 0.15,
  offlineRetryMs: 60 * 1000,
  positiveSignalDebounceMs: 150,
  retryBackoffMs: [5, 15, 30, 60, 120, 300].map((seconds) => seconds * 1000),
});

function nowIso(nowImpl) {
  return new Date(nowImpl()).toISOString();
}

function idleProbe() {
  return { phase: "idle", inFlight: false, startedAt: null };
}

function normalizeWebBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function healthEndpoint(webBaseUrl) {
  const normalized = normalizeWebBaseUrl(webBaseUrl);
  return normalized ? new URL(HEALTH_PATH, `${normalized}/`).toString() : null;
}

function transportReason(error, aborted) {
  if (aborted || error?.name === "AbortError") return "timeout";
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (code.includes("ENOTFOUND") || code.includes("EAI_AGAIN")) return "dns";
  if (code.includes("CERT")) return "certificate";
  return "transport";
}

function probePhaseFor(source, reachability, requestedPhase) {
  if (["startup", "manual", "retry", "background"].includes(requestedPhase)) return requestedPhase;
  if (source === "startup") return "startup";
  if (source === "manual") return "manual";
  if (["retry", "offline-retry", "backoff-retry", "renderer-online", "connection-change", "resume"].includes(source)) return "retry";
  return reachability === "unknown" ? "startup" : "background";
}

function createConnectivityService(options = {}) {
  const config = { ...DEFAULT_CONNECTIVITY_OPTIONS, ...(options.config || {}) };
  if (Number.isFinite(options.config?.connectedIntervalMs)) {
    config.connectedActiveIntervalMs = options.config.connectedIntervalMs;
  }
  const nowImpl = options.now || Date.now;
  const setTimeoutImpl = options.setTimeout || setTimeout;
  const clearTimeoutImpl = options.clearTimeout || clearTimeout;
  const randomImpl = options.random || Math.random;
  const netIsOnlineImpl = options.netIsOnline || (() => false);
  const listeners = new Set();
  let webBaseUrl = normalizeWebBaseUrl(options.webBaseUrl);
  let activity = "active";
  let started = false;
  let disposed = false;
  let timer = null;
  let signalTimer = null;
  let signalPromise = null;
  let resolveSignal = null;
  let inFlight = null;
  let activeController = null;
  let probeGeneration = 0;
  let reachabilityGeneration = 0;
  let deploymentGeneration = 0;
  let state = {
    reachability: "unknown",
    probe: idleProbe(),
    checkedAt: null,
    changedAt: nowIso(nowImpl),
    reason: webBaseUrl ? "not-checked" : "missing-web-base-url",
    source: "initial",
    latencyMs: null,
    nextRetryAt: null,
    netIsOnline: null,
    consecutiveFailures: 0,
    activity,
    heartbeat: { confirmationPending: false, intervalMs: null },
    deployment: { apiVersion: null, build: "unknown", environment: "unknown" },
  };

  function snapshot() {
    return {
      ...state,
      displayStatus: deriveConnectivityDisplayState(state),
      probe: { ...state.probe },
      heartbeat: { ...state.heartbeat },
      deployment: { ...state.deployment },
      deploymentGeneration,
      reachabilityGeneration,
    };
  }

  function emit() {
    const value = snapshot();
    for (const listener of listeners) listener(value);
  }

  function update(patch) {
    const nextReachability = patch.reachability || state.reachability;
    const reachabilityChanged = nextReachability !== state.reachability;
    const nextDeployment = patch.deployment || state.deployment;
    const deploymentChanged = deploymentKey(nextDeployment) !== deploymentKey(state.deployment);
    if (reachabilityChanged) reachabilityGeneration += 1;
    if (deploymentChanged) deploymentGeneration += 1;
    state = {
      ...state,
      ...patch,
      ...(patch.probe ? { probe: { ...patch.probe } } : {}),
      ...(patch.heartbeat ? { heartbeat: { ...patch.heartbeat } } : {}),
      ...(patch.deployment ? { deployment: { ...patch.deployment } } : {}),
      ...(reachabilityChanged ? { changedAt: nowIso(nowImpl) } : {}),
    };
    emit();
    return snapshot();
  }

  function clearScheduled() {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  }

  function clearSignalTimer() {
    if (signalTimer !== null) clearTimeoutImpl(signalTimer);
    signalTimer = null;
    if (resolveSignal) resolveSignal(snapshot());
    resolveSignal = null;
    signalPromise = null;
  }

  function heartbeatInterval() {
    return activity === "background"
      ? config.connectedBackgroundIntervalMs
      : config.connectedActiveIntervalMs;
  }

  function schedule(delayMs, source) {
    clearScheduled();
    if (!started || disposed || activity === "suspended") return;
    const delay = Math.max(0, delayMs);
    state = {
      ...state,
      nextRetryAt: new Date(nowImpl() + delay).toISOString(),
      heartbeat: {
        ...state.heartbeat,
        intervalMs: source === "heartbeat" ? delay : null,
      },
    };
    emit();
    timer = setTimeoutImpl(() => {
      timer = null;
      refresh(source, { force: true, phase: source === "heartbeat" ? "background" : "retry" }).catch(() => {});
    }, delay);
  }

  function scheduleHeartbeat() {
    schedule(heartbeatInterval(), "heartbeat");
  }

  function retryDelay() {
    const index = Math.min(Math.max(0, state.consecutiveFailures - 1), config.retryBackoffMs.length - 1);
    const base = config.retryBackoffMs[index];
    const jitter = base * config.jitterRatio * ((randomImpl() * 2) - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  function isFresh(maxAgeMs = config.focusStaleMs) {
    if (!isStableConnected(state) || !state.checkedAt) return false;
    const checkedAt = new Date(state.checkedAt).getTime();
    return Number.isFinite(checkedAt) && nowImpl() - checkedAt <= maxAgeMs;
  }

  function cancelInFlight() {
    probeGeneration += 1;
    activeController?.abort();
    activeController = null;
    inFlight = null;
  }

  function settleOffline(patch = {}) {
    return update({
      reachability: "offline",
      probe: idleProbe(),
      heartbeat: { confirmationPending: false, intervalMs: null },
      latencyMs: null,
      nextRetryAt: null,
      ...patch,
    });
  }

  function signalOffline(source = "strong-negative-signal", reason = "system-offline") {
    if (!started || disposed) return snapshot();
    clearSignalTimer();
    cancelInFlight();
    clearScheduled();
    const result = settleOffline({
      checkedAt: nowIso(nowImpl),
      reason,
      source,
      netIsOnline: false,
      consecutiveFailures: state.consecutiveFailures + 1,
    });
    schedule(config.offlineRetryMs, "offline-retry");
    return result;
  }

  function markReachable(source = "remote-response") {
    if (!started || disposed) return snapshot();
    if (!Boolean(netIsOnlineImpl())) return signalOffline(source, "system-offline");
    cancelInFlight();
    clearScheduled();
    const result = update({
      reachability: "connected",
      probe: idleProbe(),
      heartbeat: { confirmationPending: false, intervalMs: heartbeatInterval() },
      checkedAt: nowIso(nowImpl),
      reason: null,
      source,
      latencyMs: null,
      nextRetryAt: null,
      netIsOnline: true,
      consecutiveFailures: 0,
    });
    scheduleHeartbeat();
    return result;
  }

  function requestOnce(endpoint, requestGeneration) {
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeoutImpl(() => controller.abort(), config.healthTimeoutMs);
    return options.fetchImpl(endpoint, {
      cache: "no-store",
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    }).then((response) => ({ response, controller })).finally(() => {
      clearTimeoutImpl(timeout);
      if (requestGeneration === probeGeneration) activeController = null;
    });
  }

  function refresh(source = "background", refreshOptions = {}) {
    if (!started || disposed || activity === "suspended") return Promise.resolve(snapshot());
    if (!Boolean(netIsOnlineImpl())) return Promise.resolve(signalOffline(source, "system-offline"));
    if (inFlight) {
      const requestedPhase = probePhaseFor(source, state.reachability, refreshOptions.phase);
      if (requestedPhase === "manual" && state.probe.phase !== "manual") {
        update({ probe: { ...state.probe, phase: "manual" }, source });
      }
      return inFlight;
    }
    const maxAgeMs = Number.isFinite(refreshOptions.maxAgeMs) ? refreshOptions.maxAgeMs : config.focusStaleMs;
    if (!refreshOptions.force && isFresh(maxAgeMs)) return Promise.resolve(snapshot());
    const endpoint = healthEndpoint(webBaseUrl);
    if (!endpoint) {
      clearScheduled();
      const result = settleOffline({
        checkedAt: nowIso(nowImpl),
        reason: "missing-web-base-url",
        source,
        netIsOnline: true,
        consecutiveFailures: state.consecutiveFailures + 1,
      });
      schedule(retryDelay(), "backoff-retry");
      return Promise.resolve(result);
    }

    clearScheduled();
    const requestGeneration = ++probeGeneration;
    const startedAtMs = nowImpl();
    const phase = probePhaseFor(source, state.reachability, refreshOptions.phase);
    const confirmHeartbeat = source === "heartbeat" && state.reachability === "connected";
    update({
      probe: { phase, inFlight: true, startedAt: nowIso(nowImpl) },
      heartbeat: { confirmationPending: false, intervalMs: null },
      reason: "checking",
      source,
      latencyMs: null,
      nextRetryAt: null,
      netIsOnline: true,
    });

    inFlight = (async () => {
      let lastError = null;
      let lastController = null;
      const attempts = confirmHeartbeat ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const { response, controller } = await requestOnce(endpoint, requestGeneration);
          lastController = controller;
          if (disposed || requestGeneration !== probeGeneration) return snapshot();
          const expectedOrigin = new URL(endpoint).origin;
          const responseOrigin = response.url ? new URL(response.url).origin : expectedOrigin;
          if (responseOrigin !== expectedOrigin) throw Object.assign(new Error("Unexpected health origin"), { reason: "unexpected-origin" });
          if (response.status !== 204) throw Object.assign(new Error("Unexpected health status"), { reason: "unexpected-status" });
          const deployment = readHealthDeployment(response);
          if (deployment.apiVersion !== SUPPORTED_LAUNCHER_API_VERSION) {
            throw Object.assign(new Error("Unsupported health contract"), { reason: "unsupported-contract" });
          }
          const result = update({
            reachability: "connected",
            probe: idleProbe(),
            heartbeat: { confirmationPending: false, intervalMs: heartbeatInterval() },
            deployment,
            checkedAt: nowIso(nowImpl),
            reason: null,
            source: attempt > 0 ? "heartbeat-confirmation" : source,
            latencyMs: Math.max(0, nowImpl() - startedAtMs),
            nextRetryAt: null,
            netIsOnline: true,
            consecutiveFailures: 0,
          });
          scheduleHeartbeat();
          return result;
        } catch (error) {
          lastError = error;
          lastController = activeController;
          if (disposed || requestGeneration !== probeGeneration) return snapshot();
          if (attempt + 1 < attempts) {
            update({
              reachability: "connected",
              probe: { phase: "background", inFlight: true, startedAt: state.probe.startedAt },
              heartbeat: { confirmationPending: true, intervalMs: null },
              reason: "heartbeat-confirming",
              source: "heartbeat-confirmation",
            });
          }
        }
      }
      const failures = state.consecutiveFailures + 1;
      const result = settleOffline({
        checkedAt: nowIso(nowImpl),
        reason: lastError?.reason || transportReason(lastError, lastController?.signal?.aborted),
        source: confirmHeartbeat ? "heartbeat-confirmation" : source,
        latencyMs: Math.max(0, nowImpl() - startedAtMs),
        netIsOnline: true,
        consecutiveFailures: failures,
      });
      schedule(retryDelay(), "backoff-retry");
      return result;
    })().finally(() => {
      if (requestGeneration === probeGeneration) {
        activeController = null;
        inFlight = null;
      }
    });
    return inFlight;
  }

  function signalPossibleRecovery(source = "possible-recovery") {
    if (!started || disposed) return Promise.resolve(snapshot());
    if (!Boolean(netIsOnlineImpl())) return Promise.resolve(signalOffline(source, "system-offline"));
    if (inFlight) return inFlight;
    if (signalPromise) return signalPromise;
    signalPromise = new Promise((resolve) => { resolveSignal = resolve; });
    signalTimer = setTimeoutImpl(() => {
      signalTimer = null;
      const resolve = resolveSignal;
      resolveSignal = null;
      signalPromise = null;
      refresh(source, { force: true, phase: "retry" }).then(resolve, () => resolve(snapshot()));
    }, config.positiveSignalDebounceMs);
    return signalPromise;
  }

  function setActivity(nextActivity, source = "activity-change") {
    if (!["active", "background", "suspended"].includes(nextActivity) || nextActivity === activity) return snapshot();
    activity = nextActivity;
    update({ activity, source });
    clearScheduled();
    if (activity === "suspended") {
      clearSignalTimer();
      cancelInFlight();
      return snapshot();
    }
    if (state.reachability === "connected") scheduleHeartbeat();
    else schedule(config.offlineRetryMs, "offline-retry");
    return snapshot();
  }

  function start(source = "startup") {
    if (started || disposed) return Promise.resolve(snapshot());
    started = true;
    return refresh(source, { force: true, phase: "startup" });
  }

  function setWebBaseUrl(value, source = "web-base-url-change") {
    const normalized = normalizeWebBaseUrl(value);
    if (normalized === webBaseUrl) return Promise.resolve(snapshot());
    webBaseUrl = normalized;
    clearSignalTimer();
    cancelInFlight();
    clearScheduled();
    update({
      reachability: "offline",
      probe: idleProbe(),
      deployment: { apiVersion: null, build: "unknown", environment: "unknown" },
      checkedAt: null,
      reason: normalized ? "web-base-url-changed" : "missing-web-base-url",
      source,
      latencyMs: null,
      nextRetryAt: null,
      consecutiveFailures: 0,
    });
    return started ? refresh(source, { force: true, phase: "background" }) : Promise.resolve(snapshot());
  }

  function stop() {
    if (disposed) return;
    disposed = true;
    started = false;
    clearScheduled();
    clearSignalTimer();
    cancelInFlight();
    state = { ...state, probe: idleProbe(), nextRetryAt: null };
    listeners.clear();
  }

  return {
    config,
    getDiagnostics() {
      return { ...snapshot(), healthEndpoint: healthEndpoint(webBaseUrl), webBaseUrl };
    },
    getState: snapshot,
    isFresh,
    markReachable,
    refresh,
    setActivity,
    setWebBaseUrl,
    signalOffline,
    signalPossibleRecovery,
    start,
    stop,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  DEFAULT_CONNECTIVITY_OPTIONS,
  HEALTH_PATH,
  createConnectivityService,
  deriveConnectivityDisplayState,
  healthEndpoint,
  isStableConnected,
  normalizeWebBaseUrl,
  probePhaseFor,
  transportReason,
};
