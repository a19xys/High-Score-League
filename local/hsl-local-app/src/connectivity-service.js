const {
  deriveConnectivityDisplayState,
  isStableConnected,
} = require("./connectivity-state");

const HEALTH_PATH = "/api/launcher/health";
const DEFAULT_CONNECTIVITY_OPTIONS = Object.freeze({
  connectedIntervalMs: 5 * 60 * 1000,
  focusStaleMs: 90 * 1000,
  healthTimeoutMs: 4 * 1000,
  jitterRatio: 0.15,
  offlineRetryMs: 60 * 1000,
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
  if (["startup", "manual", "retry", "background"].includes(requestedPhase)) {
    return requestedPhase;
  }

  if (source === "startup") return "startup";
  if (source === "manual") return "manual";
  if (["retry", "offline-retry", "backoff-retry", "renderer-online"].includes(source)) return "retry";
  return reachability === "unknown" ? "startup" : "background";
}

function createConnectivityService(options = {}) {
  const config = { ...DEFAULT_CONNECTIVITY_OPTIONS, ...(options.config || {}) };
  const nowImpl = options.now || Date.now;
  const setTimeoutImpl = options.setTimeout || setTimeout;
  const clearTimeoutImpl = options.clearTimeout || clearTimeout;
  const randomImpl = options.random || Math.random;
  const netIsOnlineImpl = options.netIsOnline || (() => false);
  const listeners = new Set();
  let webBaseUrl = normalizeWebBaseUrl(options.webBaseUrl);
  let started = false;
  let disposed = false;
  let timer = null;
  let inFlight = null;
  let activeController = null;
  let probeGeneration = 0;
  let reachabilityGeneration = 0;
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
  };

  function snapshot() {
    return {
      ...state,
      displayStatus: deriveConnectivityDisplayState(state),
      probe: { ...state.probe },
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
    if (reachabilityChanged) reachabilityGeneration += 1;
    state = {
      ...state,
      ...patch,
      ...(patch.probe ? { probe: { ...patch.probe } } : {}),
      ...(reachabilityChanged ? { changedAt: nowIso(nowImpl) } : {}),
    };
    emit();
    return snapshot();
  }

  function clearScheduled() {
    if (timer !== null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
  }

  function schedule(delayMs, source) {
    clearScheduled();
    if (!started || disposed) return;
    const delay = Math.max(0, delayMs);
    state = { ...state, nextRetryAt: new Date(nowImpl() + delay).toISOString() };
    emit();
    timer = setTimeoutImpl(() => {
      timer = null;
      refresh(source, { force: true, phase: source === "periodic" ? "background" : "retry" }).catch(() => {});
    }, delay);
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
      latencyMs: null,
      nextRetryAt: null,
      ...patch,
    });
  }

  function markReachable(source = "remote-response") {
    if (!started || disposed) return snapshot();
    const netIsOnline = Boolean(netIsOnlineImpl());
    if (!netIsOnline) {
      cancelInFlight();
      clearScheduled();
      const result = settleOffline({ reason: "system-offline", source, netIsOnline: false });
      schedule(config.offlineRetryMs, "offline-retry");
      return result;
    }

    if (inFlight) cancelInFlight();
    clearScheduled();
    const result = update({
      reachability: "connected",
      probe: idleProbe(),
      checkedAt: nowIso(nowImpl),
      reason: null,
      source,
      latencyMs: null,
      nextRetryAt: null,
      netIsOnline: true,
      consecutiveFailures: 0,
    });
    schedule(config.connectedIntervalMs, "periodic");
    return result;
  }

  function refresh(source = "background", refreshOptions = {}) {
    if (!started || disposed) return Promise.resolve(snapshot());

    const netIsOnline = Boolean(netIsOnlineImpl());
    if (!netIsOnline) {
      cancelInFlight();
      clearScheduled();
      const result = settleOffline({
        checkedAt: nowIso(nowImpl),
        reason: "system-offline",
        source,
        netIsOnline: false,
        consecutiveFailures: state.consecutiveFailures + 1,
      });
      schedule(config.offlineRetryMs, "offline-retry");
      return Promise.resolve(result);
    }

    if (inFlight) {
      const requestedPhase = probePhaseFor(source, state.reachability, refreshOptions.phase);
      if (requestedPhase === "manual" && state.probe.phase !== "manual") {
        update({
          probe: { ...state.probe, phase: "manual" },
          source,
        });
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
    const controller = new AbortController();
    const phase = probePhaseFor(source, state.reachability, refreshOptions.phase);
    activeController = controller;
    update({
      probe: { phase, inFlight: true, startedAt: nowIso(nowImpl) },
      reason: "checking",
      source,
      latencyMs: null,
      nextRetryAt: null,
      netIsOnline: true,
    });
    const timeout = setTimeoutImpl(() => controller.abort(), config.healthTimeoutMs);

    inFlight = (async () => {
      try {
        const response = await options.fetchImpl(endpoint, {
          cache: "no-store",
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });

        if (disposed || requestGeneration !== probeGeneration) return snapshot();
        const expectedOrigin = new URL(endpoint).origin;
        const responseOrigin = response.url ? new URL(response.url).origin : expectedOrigin;
        if (responseOrigin !== expectedOrigin) {
          throw Object.assign(new Error("Unexpected health origin"), { reason: "unexpected-origin" });
        }
        if (response.status !== 204) {
          throw Object.assign(new Error("Unexpected health status"), { reason: "unexpected-status" });
        }

        const result = update({
          reachability: "connected",
          probe: idleProbe(),
          checkedAt: nowIso(nowImpl),
          reason: null,
          source,
          latencyMs: Math.max(0, nowImpl() - startedAtMs),
          nextRetryAt: null,
          netIsOnline: true,
          consecutiveFailures: 0,
        });
        schedule(config.connectedIntervalMs, "periodic");
        return result;
      } catch (error) {
        if (disposed || requestGeneration !== probeGeneration) return snapshot();
        const failures = state.consecutiveFailures + 1;
        const result = settleOffline({
          checkedAt: nowIso(nowImpl),
          reason: error?.reason || transportReason(error, controller.signal.aborted),
          source,
          latencyMs: Math.max(0, nowImpl() - startedAtMs),
          netIsOnline: true,
          consecutiveFailures: failures,
        });
        schedule(retryDelay(), "backoff-retry");
        return result;
      } finally {
        clearTimeoutImpl(timeout);
        if (requestGeneration === probeGeneration) {
          activeController = null;
          inFlight = null;
        }
      }
    })();

    return inFlight;
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
    cancelInFlight();
    clearScheduled();
    update({
      reachability: "offline",
      probe: idleProbe(),
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
    setWebBaseUrl,
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
