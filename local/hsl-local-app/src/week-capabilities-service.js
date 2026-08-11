const { isCommittedConnected, normalizeWebBaseUrl } = require("./connectivity-service");
const { createWeekCapabilityCache } = require("./competitive-authority-cache");
const {
  deploymentFingerprintsMatch,
  deploymentKey,
  readHealthDeployment,
  readRankingDeployment,
} = require("./deployment-fingerprint");

const WEEK_CAPABILITIES_PATH = "/api/launcher/week-capabilities";
const WEEK_CAPABILITIES_CONTRACT_VERSION = 1;
const DEFAULT_WEEK_CAPABILITIES_OPTIONS = Object.freeze({
  batchLimit: 100,
  requestTimeoutMs: 4 * 1000,
});
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;

function validWeekId(value) {
  return typeof value === "string" && identifierPattern.test(value);
}

function weekCapabilitiesEndpoint(webBaseUrl) {
  const normalized = normalizeWebBaseUrl(webBaseUrl);
  return normalized ? new URL(WEEK_CAPABILITIES_PATH, `${normalized}/`).toString() : null;
}

function createWeekCapabilitiesService(options = {}) {
  const config = { ...DEFAULT_WEEK_CAPABILITIES_OPTIONS, ...(options.config || {}) };
  const cache = options.cache || createWeekCapabilityCache({ userDataDir: options.userDataDir }, options.cacheOptions);
  const listeners = new Set();
  const now = options.now || Date.now;
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  let context = {
    deployment: { ...(options.getConnectivityState?.()?.deployment || {}) },
    deploymentKey: deploymentKey(options.getConnectivityState?.()?.deployment),
    fingerprint: "",
    generation: 0,
    webBaseUrl: null,
    weekIds: [],
  };
  let initialized = false;
  let stopped = false;
  let inFlight = null;
  let controller = null;
  let boundaryTimer = null;
  let pendingIds = new Set();
  let sequence = 0;
  let lastRequest = null;

  function connection() {
    return options.getConnectivityState?.() || {};
  }

  function authorityContext() {
    return { deploymentKey: context.deploymentKey, origin: context.webBaseUrl };
  }

  function fallback(weekId) {
    return {
      canPlayCompetition: false,
      checkedAt: null,
      conclusive: false,
      derivedStatus: null,
      finalDeadlineAt: null,
      publicFreezeAt: null,
      publicStartAt: null,
      publicState: pendingIds.has(weekId) ? "checking" : "unknown",
      rawStatus: null,
      reason: pendingIds.has(weekId) ? "checking" : "not-checked",
      seasonId: null,
      source: "none",
      weekId,
    };
  }

  function getCapability(weekId) {
    if (!validWeekId(weekId)) {
      return { ...fallback(null), conclusive: true, publicState: "unlinked", reason: "not-linked" };
    }
    return cache.read(authorityContext(), weekId, now()) || fallback(weekId);
  }

  function snapshot() {
    return {
      contractVersion: WEEK_CAPABILITIES_CONTRACT_VERSION,
      entries: Object.fromEntries(context.weekIds.map((weekId) => [weekId, getCapability(weekId)])),
      generation: context.generation,
      inFlight: Boolean(inFlight),
      initialized,
      stateSequence: sequence,
      webBaseUrl: context.webBaseUrl,
    };
  }

  function clearBoundaryTimer() {
    if (boundaryTimer !== null) cancelTimeout(boundaryTimer);
    boundaryTimer = null;
  }

  function scheduleBoundary() {
    clearBoundaryTimer();
    if (stopped) return;
    const next = context.weekIds
      .map((weekId) => getCapability(weekId).nextBoundaryAt)
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (!Number.isFinite(next)) return;
    boundaryTimer = scheduleTimeout(() => {
      boundaryTimer = null;
      emit("local-time-boundary");
      scheduleBoundary();
    }, Math.min(2_147_483_647, Math.max(0, next - now()) + 1));
    boundaryTimer?.unref?.();
  }

  function emit(reason) {
    sequence += 1;
    const state = snapshot();
    for (const listener of listeners) listener(state, reason);
    options.onChanged?.(state, reason);
  }

  async function initialize() {
    if (!initialized) {
      await cache.initialize();
      initialized = true;
      scheduleBoundary();
    }
    return snapshot();
  }

  function replaceContext(next) {
    context = { ...next, generation: context.generation + 1 };
    controller?.abort("context-change");
    controller = null;
    inFlight = null;
    pendingIds = new Set();
    emit("context-change");
    scheduleBoundary();
    return snapshot();
  }

  function updateContext(input = {}) {
    const webBaseUrl = normalizeWebBaseUrl(input.webBaseUrl);
    const deployment = { ...(connection().deployment || {}) };
    const observedDeploymentKey = deploymentKey(deployment);
    const nextDeploymentKey = observedDeploymentKey === "unknown:unknown:0"
      ? cache.resolveDeploymentKey(webBaseUrl) || observedDeploymentKey
      : observedDeploymentKey;
    const weekIds = [...new Set((input.packs || []).map((pack) => pack?.weekId).filter(validWeekId))].sort();
    const fingerprint = `${webBaseUrl || "missing"}|${nextDeploymentKey}|${weekIds.join("|")}`;
    if (fingerprint === context.fingerprint) return snapshot();
    return replaceContext({ deployment, deploymentKey: nextDeploymentKey, fingerprint, webBaseUrl, weekIds });
  }

  function updateDeployment() {
    const deployment = { ...(connection().deployment || {}) };
    const observedDeploymentKey = deploymentKey(deployment);
    const nextDeploymentKey = observedDeploymentKey === "unknown:unknown:0"
      ? cache.resolveDeploymentKey(context.webBaseUrl) || observedDeploymentKey
      : observedDeploymentKey;
    if (nextDeploymentKey === context.deploymentKey) return snapshot();
    return replaceContext({
      ...context,
      deployment,
      deploymentKey: nextDeploymentKey,
      fingerprint: `${context.webBaseUrl || "missing"}|${nextDeploymentKey}|${context.weekIds.join("|")}`,
    });
  }

  function validateResponse(payload, requests, expectedDeployment) {
    if (!payload || payload.version !== WEEK_CAPABILITIES_CONTRACT_VERSION || !Array.isArray(payload.results)) {
      throw Object.assign(new Error("Invalid week capability response"), { reason: "invalid-response" });
    }
    const bodyDeployment = readRankingDeployment(payload);
    if (!deploymentFingerprintsMatch(expectedDeployment, bodyDeployment)) {
      throw Object.assign(new Error("Week capability deployment mismatch"), { reason: "deployment-mismatch" });
    }
    const byKey = new Map(payload.results.map((item) => [item?.requestKey, item]));
    return requests.map((request) => {
      const result = byKey.get(request.requestKey);
      if (!result || result.weekId !== request.weekId || !["inactive", "active", "closed", "unlinked"].includes(result.publicState)) {
        throw Object.assign(new Error("Incomplete week capability response"), { reason: "invalid-response" });
      }
      return {
        canPlayCompetition: result.publicState === "active",
        checkedAt: payload.generatedAt || new Date(now()).toISOString(),
        conclusive: true,
        derivedStatus: result.derivedStatus || null,
        finalDeadlineAt: result.finalDeadlineAt || null,
        publicFreezeAt: result.publicFreezeAt || null,
        publicStartAt: result.publicStartAt || null,
        publicState: result.publicState,
        rawStatus: result.rawStatus || null,
        reason: result.reason || "server-result",
        seasonId: result.seasonId || null,
        seasonStatus: result.seasonStatus || null,
        weekId: request.weekId,
      };
    });
  }

  function refresh(reason = "context", refreshOptions = {}) {
    if (stopped || !isCommittedConnected(connection())) return Promise.resolve(snapshot());
    if (inFlight) return inFlight;
    const endpoint = weekCapabilitiesEndpoint(context.webBaseUrl);
    const requestedIds = (refreshOptions.weekIds || context.weekIds)
      .filter((weekId) => context.weekIds.includes(weekId))
      .filter((weekId) => refreshOptions.force === true || !cache.read(authorityContext(), weekId, now()));
    if (!endpoint || requestedIds.length === 0) return Promise.resolve(snapshot());

    const generation = context.generation;
    const requestOrigin = context.webBaseUrl;
    const requestDeployment = { ...context.deployment };
    const requestDeploymentKey = context.deploymentKey;
    const reachabilityGeneration = connection().reachabilityGeneration;
    controller = new AbortController();
    const activeController = controller;
    pendingIds = new Set(requestedIds);
    emit(`${reason}:start`);
    const timeout = scheduleTimeout(() => activeController.abort("timeout"), config.requestTimeoutMs);
    timeout?.unref?.();

    inFlight = (async () => {
      try {
        const results = [];
        for (let start = 0; start < requestedIds.length; start += config.batchLimit) {
          const ids = requestedIds.slice(start, start + config.batchLimit);
          const requests = ids.map((weekId, index) => ({ requestKey: `week-${start + index}`, weekId }));
          const response = await options.fetchImpl(endpoint, {
            body: JSON.stringify({ version: WEEK_CAPABILITIES_CONTRACT_VERSION, requests }),
            cache: "no-store",
            headers: { "content-type": "application/json" },
            method: "POST",
            redirect: "manual",
            signal: activeController.signal,
          });
          const headerDeployment = readHealthDeployment(response);
          lastRequest = { checkedAt: new Date(now()).toISOString(), httpStatus: response.status, reason: response.ok ? null : `http-${response.status}` };
          if (!deploymentFingerprintsMatch(requestDeployment, headerDeployment)) {
            throw Object.assign(new Error("Week headers differ from health"), { reason: "deployment-mismatch" });
          }
          if (!response.ok) throw Object.assign(new Error("Week endpoint unavailable"), { reason: `http-${response.status}` });
          results.push(...validateResponse(await response.json(), requests, headerDeployment));
        }
        const stillCurrent = !stopped
          && generation === context.generation
          && requestOrigin === context.webBaseUrl
          && requestDeploymentKey === context.deploymentKey
          && reachabilityGeneration === connection().reachabilityGeneration;
        if (stillCurrent) {
          for (const result of results) await cache.remember(authorityContext(), result);
        }
      } catch (error) {
        const failure = activeController.signal.aborted ? "timeout" : String(error?.reason || "temporary-failure");
        lastRequest = { checkedAt: new Date(now()).toISOString(), httpStatus: null, reason: failure };
        if (["timeout", "temporary-failure"].includes(failure)) options.onTransportFailure?.("week-capabilities");
      } finally {
        cancelTimeout(timeout);
        if (generation === context.generation && controller === activeController) {
          controller = null;
          inFlight = null;
          pendingIds = new Set();
          emit(`${reason}:complete`);
          scheduleBoundary();
        }
      }
      return snapshot();
    })();
    return inFlight;
  }

  function stop() {
    stopped = true;
    context.generation += 1;
    controller?.abort("shutdown");
    clearBoundaryTimer();
    listeners.clear();
  }

  return {
    getAuthorityContext: () => ({ deploymentKey: context.deploymentKey, origin: context.webBaseUrl }),
    getCapability,
    getDiagnostics: () => ({
      cachePath: cache.path,
      context: { deploymentKey: context.deploymentKey, generation: context.generation, webBaseUrl: context.webBaseUrl, weekCount: context.weekIds.length },
      inFlight: Boolean(inFlight),
      lastRequest,
      timerActive: boundaryTimer !== null,
    }),
    getState: snapshot,
    initialize,
    refresh,
    stop,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateContext,
    updateDeployment,
  };
}

module.exports = {
  DEFAULT_WEEK_CAPABILITIES_OPTIONS,
  WEEK_CAPABILITIES_CONTRACT_VERSION,
  WEEK_CAPABILITIES_PATH,
  createWeekCapabilitiesService,
  validWeekId,
  weekCapabilitiesEndpoint,
};
