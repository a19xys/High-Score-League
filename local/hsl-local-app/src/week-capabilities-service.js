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
  maxAgeMs: 60 * 1000,
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

function publicDeployment(deployment = {}) {
  return {
    apiVersion: Number(deployment.apiVersion) || null,
    build: String(deployment.build || "unknown"),
    environment: String(deployment.environment || "unknown"),
  };
}

function abortedRequestReason(signal) {
  if (!signal?.aborted) return null;
  const reason = String(signal.reason || "cancelled");
  if (reason === "timeout") return "timeout";
  if (reason === "context-change") return "stale-context";
  return "cancelled";
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
  let activeRun = null;
  let controller = null;
  let boundaryTimer = null;
  let pendingIds = new Set();
  let inFlightIds = new Set();
  let sequence = 0;
  let requestSequence = 0;
  let lastRequest = null;
  let lastPreflight = null;
  const lastResults = new Map();

  function connection() {
    return options.getConnectivityState?.() || {};
  }

  function authorityContext() {
    return { deploymentKey: context.deploymentKey, origin: context.webBaseUrl };
  }

  function fallback(weekId) {
    return {
      ageMs: null,
      canPlayCompetition: false,
      checkedAt: null,
      conclusive: false,
      derivedStatus: null,
      finalDeadlineAt: null,
      fresh: false,
      publicFreezeAt: null,
      publicStartAt: null,
      publicState: pendingIds.has(weekId) ? "checking" : "unknown",
      rawStatus: null,
      reason: pendingIds.has(weekId) ? "checking" : "not-checked",
      seasonId: null,
      source: "none",
      usable: false,
      weekId,
    };
  }

  function withFreshness(capability) {
    if (!capability) return null;
    const checkedAtMs = Date.parse(capability.checkedAt || "");
    const ageMs = Number.isFinite(checkedAtMs) ? Math.max(0, now() - checkedAtMs) : null;
    return {
      ...capability,
      ageMs,
      fresh: ageMs !== null && ageMs <= config.maxAgeMs,
      usable: capability.conclusive === true,
    };
  }

  function getCapability(weekId) {
    if (!validWeekId(weekId)) {
      return { ...fallback(null), conclusive: true, publicState: "unlinked", reason: "not-linked" };
    }
    return withFreshness(cache.read(authorityContext(), weekId, now())) || fallback(weekId);
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
    activeRun = null;
    pendingIds = new Set();
    inFlightIds = new Set();
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
    const capabilities = requests.map((request) => {
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
    return { bodyDeployment, capabilities };
  }

  function runRefresh(reason = "context", refreshOptions = {}) {
    if (stopped || !isCommittedConnected(connection())) {
      return Promise.resolve({ requestedIds: [], results: new Map(), runId: null, state: snapshot() });
    }
    if (activeRun) return activeRun.promise;
    const endpoint = weekCapabilitiesEndpoint(context.webBaseUrl);
    const requestedIds = (refreshOptions.weekIds || context.weekIds)
      .filter((weekId) => context.weekIds.includes(weekId))
      .filter((weekId) => refreshOptions.force === true || !getCapability(weekId).fresh);
    if (!endpoint || requestedIds.length === 0) {
      const failure = endpoint ? "nothing-to-refresh" : "missing-endpoint";
      const results = new Map(requestedIds.map((weekId) => [weekId, {
        checkedAt: new Date(now()).toISOString(),
        reason: failure,
        runId: null,
        status: "failed",
      }]));
      return Promise.resolve({ requestedIds, results, runId: null, state: snapshot() });
    }

    const generation = context.generation;
    const requestOrigin = context.webBaseUrl;
    const requestDeployment = { ...context.deployment };
    const requestDeploymentKey = context.deploymentKey;
    const reachabilityGeneration = connection().reachabilityGeneration;
    const runId = ++requestSequence;
    const run = { ids: new Set(requestedIds), promise: null, runId };
    controller = new AbortController();
    const activeController = controller;
    pendingIds = new Set(requestedIds);
    inFlightIds = new Set(requestedIds);
    const timeout = scheduleTimeout(() => activeController.abort("timeout"), config.requestTimeoutMs);
    timeout?.unref?.();

    let requestDiagnostic = {
      checkedAt: new Date(now()).toISOString(),
      contentType: null,
      contractVersion: WEEK_CAPABILITIES_CONTRACT_VERSION,
      contractValidation: "pending",
      deploymentMatch: null,
      endpoint,
      expectedDeployment: publicDeployment(requestDeployment),
      httpStatus: null,
      reason: "requesting",
      requestReason: reason,
      requestKeys: requestedIds.map((_weekId, index) => `week-${index}`),
      requestedIds: [...requestedIds],
      result: "pending",
      runId,
    };
    const updateRequestDiagnostic = (patch) => {
      requestDiagnostic = { ...requestDiagnostic, ...patch };
      if (!lastRequest || Number(lastRequest.runId) <= runId) lastRequest = requestDiagnostic;
    };
    updateRequestDiagnostic({});
    let resolveRun;
    let rejectRun;
    run.promise = new Promise((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    const execute = async () => {
      const runResults = new Map();
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
          const headerDeploymentMatches = deploymentFingerprintsMatch(requestDeployment, headerDeployment);
          const contentType = response.headers?.get?.("content-type") || null;
          updateRequestDiagnostic({
            checkedAt: new Date(now()).toISOString(),
            contentType,
            httpStatus: response.status,
            deploymentMatch: response.ok ? headerDeploymentMatches : null,
            receivedHeaderDeployment: publicDeployment(headerDeployment),
            reason: response.ok ? null : `http-${response.status}`,
          });
          if (!response.ok) throw Object.assign(new Error("Week endpoint unavailable"), { reason: `http-${response.status}` });
          if (!headerDeploymentMatches) {
            throw Object.assign(new Error("Week headers differ from health"), { reason: "deployment-mismatch" });
          }
          let payload;
          try {
            payload = await response.json();
          } catch {
            throw Object.assign(new Error("Invalid week capability JSON"), { reason: "invalid-json" });
          }
          const bodyDeployment = readRankingDeployment(payload);
          const bodyDeploymentMatches = deploymentFingerprintsMatch(headerDeployment, bodyDeployment);
          updateRequestDiagnostic({
            deploymentMatch: headerDeploymentMatches && bodyDeploymentMatches,
            receivedBodyDeployment: publicDeployment(bodyDeployment),
          });
          const validated = validateResponse(payload, requests, headerDeployment);
          updateRequestDiagnostic({
            contractValidation: "valid",
            receivedBodyDeployment: publicDeployment(validated.bodyDeployment),
            responseResults: validated.capabilities.map((capability) => ({
              publicState: capability.publicState,
              weekId: capability.weekId,
            })),
          });
          results.push(...validated.capabilities);
        }
        const stillCurrent = !stopped
          && generation === context.generation
          && requestOrigin === context.webBaseUrl
          && requestDeploymentKey === context.deploymentKey
          && reachabilityGeneration === connection().reachabilityGeneration;
        if (stillCurrent) {
          for (const result of results) {
            await cache.remember(authorityContext(), result);
            const outcome = { checkedAt: result.checkedAt, reason: result.reason, runId, status: "updated" };
            lastResults.set(result.weekId, outcome);
            runResults.set(result.weekId, outcome);
          }
          updateRequestDiagnostic({ reason: null, result: "updated" });
        } else {
          for (const weekId of requestedIds) {
            const outcome = { checkedAt: new Date(now()).toISOString(), reason: "stale-context", runId, status: "stale" };
            lastResults.set(weekId, outcome);
            runResults.set(weekId, outcome);
          }
          updateRequestDiagnostic({ reason: "stale-context", result: "stale" });
        }
      } catch (error) {
        const failure = abortedRequestReason(activeController.signal) || String(error?.reason || "temporary-failure");
        const checkedAt = new Date(now()).toISOString();
        updateRequestDiagnostic({
          checkedAt,
          contractValidation: ["invalid-json", "invalid-response"].includes(failure) ? "invalid" : requestDiagnostic.contractValidation,
          reason: failure,
          result: "failed",
        });
        for (const weekId of requestedIds) {
          const outcome = { checkedAt, reason: failure, runId, status: failure === "stale-context" ? "stale" : "failed" };
          lastResults.set(weekId, outcome);
          runResults.set(weekId, outcome);
        }
        if (failure === "timeout" || failure === "temporary-failure" || failure.startsWith("http-")) options.onTransportFailure?.("week-capabilities");
      } finally {
        cancelTimeout(timeout);
        if (activeRun === run) {
          controller = null;
          inFlight = null;
          activeRun = null;
          pendingIds = new Set();
          inFlightIds = new Set();
          if (generation === context.generation) {
            emit(`${reason}:complete`);
            scheduleBoundary();
          }
        }
      }
      return { requestedIds, results: runResults, runId, state: snapshot() };
    };
    activeRun = run;
    inFlight = run.promise;
    emit(`${reason}:start`);
    execute().then(resolveRun, rejectRun);
    return run.promise;
  }

  async function refresh(reason = "context", refreshOptions = {}) {
    return (await runRefresh(reason, refreshOptions)).state;
  }

  function preflightResult(weekId, outcome) {
    const attempt = outcome?.results?.get(weekId) || null;
    const capability = getCapability(weekId);
    const result = {
      capability,
      checkedAt: attempt?.checkedAt || new Date(now()).toISOString(),
      ok: attempt?.status === "updated",
      reason: attempt?.reason || "temporary-failure",
      requestRunId: outcome?.runId || null,
      status: attempt?.status || "failed",
      weekId,
    };
    lastPreflight = result;
    return result;
  }

  async function ensureFreshCapability(weekId, reason = "play-preflight") {
    if (!validWeekId(weekId) || !context.weekIds.includes(weekId)) {
      const result = { capability: getCapability(weekId), checkedAt: new Date(now()).toISOString(), ok: false, reason: "stale-context", status: "stale", weekId };
      lastPreflight = result;
      return result;
    }
    if (stopped || !isCommittedConnected(connection())) {
      const result = { capability: getCapability(weekId), checkedAt: new Date(now()).toISOString(), ok: false, reason: "not-connected", status: "skipped", weekId };
      lastPreflight = result;
      return result;
    }

    const sharedRun = activeRun;
    if (sharedRun) {
      const sharedOutcome = await sharedRun.promise;
      if (sharedRun.ids.has(weekId)) return preflightResult(weekId, sharedOutcome);
    }

    const outcome = await runRefresh(reason, { force: true, weekIds: [weekId] });
    return preflightResult(weekId, outcome);
  }

  function stop() {
    stopped = true;
    context.generation += 1;
    controller?.abort("shutdown");
    controller = null;
    inFlight = null;
    activeRun = null;
    pendingIds = new Set();
    inFlightIds = new Set();
    clearBoundaryTimer();
    listeners.clear();
  }

  return {
    getAuthorityContext: () => ({ deploymentKey: context.deploymentKey, origin: context.webBaseUrl }),
    getCapability,
    getDiagnostics: () => ({
      cachePath: cache.path,
      capabilities: Object.fromEntries(context.weekIds.map((weekId) => [weekId, getCapability(weekId)])),
      context: { deploymentKey: context.deploymentKey, generation: context.generation, webBaseUrl: context.webBaseUrl, weekCount: context.weekIds.length },
      inFlight: Boolean(inFlight),
      lastRequest,
      lastPreflight,
      timerActive: boundaryTimer !== null,
    }),
    getState: snapshot,
    initialize,
    ensureFreshCapability,
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
