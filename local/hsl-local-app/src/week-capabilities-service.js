const { isCommittedConnected, normalizeWebBaseUrl } = require("./connectivity-service");
const { createWeekCapabilityCache } = require("./competitive-authority-cache");
const {
  deploymentMetadataExactlyMatches,
  isSupportedLauncherApiVersion,
  launcherAuthorityKey,
  readHealthDeployment,
  readRankingDeployment,
} = require("./deployment-fingerprint");

const WEEK_CAPABILITIES_PATH = "/api/launcher/week-capabilities";
const WEEK_CAPABILITIES_CONTRACT_VERSION = 1;
const DEFAULT_WEEK_CAPABILITIES_OPTIONS = Object.freeze({
  batchLimit: 100,
  maxAgeMs: 60 * 1000,
  requestTimeoutMs: 4 * 1000,
  retryBaseMs: 5 * 1000,
  retryMaxMs: 5 * 60 * 1000,
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
    authorityKey: launcherAuthorityKey(),
    fingerprint: "",
    generation: 0,
    observedDeployment: { ...(options.getConnectivityState?.()?.deployment || {}) },
    webBaseUrl: null,
    weekIds: [],
  };
  let initialized = false;
  let stopped = false;
  let suspended = false;
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
  let lastAttemptAt = null;
  let lastAttemptTrigger = null;
  let lastAttemptResult = null;
  let lastSuccessAt = null;
  let lastFailureAt = null;
  let lastFailureReason = null;
  let retryAttempt = 0;
  let retryScheduledAt = null;
  let deploymentMetadataChanges = 0;
  const lastResults = new Map();

  function connection() {
    return options.getConnectivityState?.() || {};
  }

  function authorityContext() {
    return { authorityKey: context.authorityKey, origin: context.webBaseUrl };
  }

  function fallback(weekId) {
    const checking = pendingIds.has(weekId);
    return {
      ageMs: null,
      authorityState: checking ? "refreshing" : "unknown",
      canPlayCompetition: false,
      checkedAt: null,
      conclusive: false,
      currentAuthority: false,
      currentConclusive: false,
      derivedStatus: null,
      finalDeadlineAt: null,
      fresh: false,
      lastKnownPublicState: null,
      lastKnownReason: null,
      publicFreezeAt: null,
      publicStartAt: null,
      publicState: checking ? "checking" : "unknown",
      rawStatus: null,
      reason: checking ? "checking" : "not-checked",
      seasonId: null,
      source: "none",
      usable: false,
      usableForCompetition: false,
      weekId,
    };
  }

  function withFreshness(capability) {
    if (!capability) return null;
    const checkedAtMs = Date.parse(capability.checkedAt || "");
    const ageMs = Number.isFinite(checkedAtMs) ? Math.max(0, now() - checkedAtMs) : null;
    const fresh = ageMs !== null && ageMs <= config.maxAgeMs;
    const connectivity = connection();
    const connected = isCommittedConnected(connectivity);
    const offline = connectivity.reachability === "offline";
    const refreshing = inFlightIds.has(capability.weekId);
    const lastAttempt = lastResults.get(capability.weekId);
    const lastAttemptMs = Date.parse(lastAttempt?.checkedAt || "");
    const failedAfterKnown = lastAttempt?.status === "failed"
      && Number.isFinite(lastAttemptMs)
      && (!Number.isFinite(checkedAtMs) || lastAttemptMs >= checkedAtMs);
    const lastKnownPublicState = capability.lastKnownPublicState || capability.publicState;
    let authorityState = "stale";
    let currentAuthority = false;
    let publicState = "unknown";

    if (offline) {
      authorityState = "offline-durable";
      publicState = lastKnownPublicState;
    } else if (!connected) {
      authorityState = "awaiting-connectivity";
    } else if (fresh) {
      authorityState = "fresh-confirmed";
      currentAuthority = true;
      publicState = lastKnownPublicState;
    } else if (refreshing) {
      authorityState = "refreshing";
      currentAuthority = true;
      publicState = lastKnownPublicState;
    } else if (failedAfterKnown) {
      authorityState = "stale-error";
    }

    const usableForCompetition = capability.conclusive === true
      && publicState === "active"
      && (currentAuthority || authorityState === "offline-durable");
    return {
      ...capability,
      ageMs,
      authorityState,
      canPlayCompetition: usableForCompetition,
      currentAuthority,
      currentConclusive: capability.conclusive === true && currentAuthority,
      fresh,
      lastKnownPublicState,
      lastKnownReason: capability.reason || null,
      publicState,
      reason: publicState === "unknown" && capability.conclusive === true
        ? "stale-no-current-confirmation"
        : capability.reason,
      usable: capability.conclusive === true,
      usableForCompetition,
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
    if (stopped || suspended || activeRun) return;
    const connected = isCommittedConnected(connection());
    const endpoint = weekCapabilitiesEndpoint(context.webBaseUrl);
    const candidates = [];

    for (const weekId of context.weekIds) {
      const capability = getCapability(weekId);
      if (Number.isFinite(capability.nextBoundaryAt)) {
        candidates.push({ at: capability.nextBoundaryAt, kind: "calendar-boundary", weekIds: [weekId] });
      }
      if (connected && endpoint && retryScheduledAt === null) {
        const checkedAt = Date.parse(capability.checkedAt || "");
        candidates.push({
          at: Number.isFinite(checkedAt) ? checkedAt + config.maxAgeMs + 1 : now(),
          kind: "freshness-expired",
          weekIds: [weekId],
        });
      }
    }

    if (connected && endpoint && Number.isFinite(retryScheduledAt)) {
      candidates.push({ at: retryScheduledAt, kind: "freshness-retry", weekIds: [...context.weekIds] });
    }

    const next = candidates.sort((left, right) => left.at - right.at)[0];
    if (!next || !Number.isFinite(next.at)) return;
    const dueWeekIds = [...new Set(candidates
      .filter((candidate) => candidate.kind === next.kind && candidate.at === next.at)
      .flatMap((candidate) => candidate.weekIds))];
    boundaryTimer = scheduleTimeout(() => {
      boundaryTimer = null;
      if (stopped || suspended) return;
      if (isCommittedConnected(connection())) {
        runRefresh(next.kind, {
          force: next.kind !== "freshness-expired",
          weekIds: dueWeekIds,
        }).catch(() => {});
        return;
      }
      emit(next.kind);
      scheduleBoundary();
    }, Math.min(2_147_483_647, Math.max(0, next.at - now())));
    boundaryTimer?.unref?.();
  }

  function resetRetry() {
    retryAttempt = 0;
    retryScheduledAt = null;
  }

  function scheduleRetry(failure) {
    if (stopped || suspended || ["cancelled", "stale-context"].includes(failure)) return;
    retryAttempt += 1;
    const delay = Math.min(config.retryMaxMs, config.retryBaseMs * (2 ** Math.max(0, retryAttempt - 1)));
    retryScheduledAt = now() + delay;
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
    clearBoundaryTimer();
    context = { ...next, generation: context.generation + 1 };
    controller?.abort("context-change");
    controller = null;
    inFlight = null;
    activeRun = null;
    pendingIds = new Set();
    inFlightIds = new Set();
    lastResults.clear();
    resetRetry();
    emit("context-change");
    scheduleBoundary();
    return snapshot();
  }

  function observeDeploymentMetadata() {
    const observedDeployment = { ...(connection().deployment || {}) };
    if (!deploymentMetadataExactlyMatches(context.observedDeployment, observedDeployment)) {
      deploymentMetadataChanges += 1;
      context = { ...context, observedDeployment };
    }
    return observedDeployment;
  }

  function updateContext(input = {}) {
    const webBaseUrl = normalizeWebBaseUrl(input.webBaseUrl);
    const observedDeployment = { ...(connection().deployment || {}) };
    const weekIds = [...new Set((input.packs || []).map((pack) => pack?.weekId).filter(validWeekId))].sort();
    const authorityKey = launcherAuthorityKey();
    const fingerprint = `${webBaseUrl || "missing"}|${authorityKey}|${weekIds.join("|")}`;
    if (fingerprint === context.fingerprint) {
      observeDeploymentMetadata();
      return snapshot();
    }
    return replaceContext({
      authorityKey,
      fingerprint,
      observedDeployment,
      webBaseUrl,
      weekIds,
    });
  }

  function updateDeployment() {
    observeDeploymentMetadata();
    return snapshot();
  }

  function validateResponse(payload, requests) {
    if (!payload || payload.version !== WEEK_CAPABILITIES_CONTRACT_VERSION || !Array.isArray(payload.results)) {
      throw Object.assign(new Error("Invalid week capability response"), { reason: "invalid-response" });
    }
    const bodyDeployment = readRankingDeployment(payload);
    if (!isSupportedLauncherApiVersion(bodyDeployment.apiVersion)) {
      throw Object.assign(new Error("Unsupported week capability contract"), { reason: "unsupported-contract" });
    }
    const byKey = new Map(payload.results.map((item) => [item?.requestKey, item]));
    const capabilities = requests.map((request) => {
      const result = byKey.get(request.requestKey);
      if (!result || result.weekId !== request.weekId || !["inactive", "active", "closed", "unlinked"].includes(result.publicState)) {
        throw Object.assign(new Error("Incomplete week capability response"), { reason: "invalid-response" });
      }
      return {
        canPlayCompetition: result.publicState === "active",
        checkedAt: new Date(now()).toISOString(),
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
    if (stopped || suspended || !isCommittedConnected(connection())) {
      return Promise.resolve({ requestedIds: [], results: new Map(), runId: null, state: snapshot() });
    }
    updateDeployment();
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

    const connectivityDeployment = { ...(connection().deployment || {}) };
    if (!isSupportedLauncherApiVersion(connectivityDeployment.apiVersion)) {
      const checkedAt = new Date(now()).toISOString();
      const failure = "unsupported-contract";
      const results = new Map(requestedIds.map((weekId) => [weekId, {
        checkedAt,
        reason: failure,
        runId: null,
        status: "failed",
      }]));
      for (const [weekId, result] of results) lastResults.set(weekId, result);
      lastAttemptAt = checkedAt;
      lastAttemptTrigger = reason;
      lastAttemptResult = "failed";
      lastFailureAt = checkedAt;
      lastFailureReason = failure;
      lastRequest = {
        checkedAt,
        contractVersion: WEEK_CAPABILITIES_CONTRACT_VERSION,
        contractCompatible: false,
        contractValidation: "invalid",
        endpoint,
        healthDeployment: publicDeployment(connectivityDeployment),
        reason: failure,
        requestReason: reason,
        requestKeys: requestedIds.map((_weekId, index) => `week-${index}`),
        requestedIds: [...requestedIds],
        result: "failed",
        runId: null,
      };
      scheduleRetry(failure);
      emit(`${reason}:blocked`);
      scheduleBoundary();
      return Promise.resolve({ requestedIds, results, runId: null, state: snapshot() });
    }

    const generation = context.generation;
    const requestOrigin = context.webBaseUrl;
    const requestAuthorityKey = context.authorityKey;
    const requestDeployment = { ...connectivityDeployment };
    const reachabilityGeneration = connection().reachabilityGeneration;
    const runId = ++requestSequence;
    const run = { ids: new Set(requestedIds), promise: null, runId };
    controller = new AbortController();
    clearBoundaryTimer();
    const activeController = controller;
    pendingIds = new Set(requestedIds);
    inFlightIds = new Set(requestedIds);
    const timeout = scheduleTimeout(() => activeController.abort("timeout"), config.requestTimeoutMs);
    timeout?.unref?.();

    let requestDiagnostic = {
      checkedAt: new Date(now()).toISOString(),
      contentType: null,
      contractCompatible: null,
      contractVersion: WEEK_CAPABILITIES_CONTRACT_VERSION,
      contractValidation: "pending",
      endpoint,
      healthDeployment: publicDeployment(requestDeployment),
      httpStatus: null,
      metadataMatchesHealth: null,
      reason: "requesting",
      requestReason: reason,
      requestKeys: requestedIds.map((_weekId, index) => `week-${index}`),
      requestedIds: [...requestedIds],
      result: "pending",
      runId,
    };
    lastAttemptAt = requestDiagnostic.checkedAt;
    lastAttemptTrigger = reason;
    lastAttemptResult = "pending";
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
          const headerContractCompatible = isSupportedLauncherApiVersion(headerDeployment.apiVersion);
          const headerMetadataMatchesHealth = deploymentMetadataExactlyMatches(requestDeployment, headerDeployment);
          const contentType = response.headers?.get?.("content-type") || null;
          updateRequestDiagnostic({
            checkedAt: new Date(now()).toISOString(),
            contentType,
            contractCompatible: response.ok ? headerContractCompatible : null,
            httpStatus: response.status,
            metadataMatchesHealth: response.ok ? headerMetadataMatchesHealth : null,
            receivedHeaderDeployment: publicDeployment(headerDeployment),
            reason: response.ok ? null : `http-${response.status}`,
          });
          if (!response.ok) throw Object.assign(new Error("Week endpoint unavailable"), { reason: `http-${response.status}` });
          if (!headerContractCompatible) {
            throw Object.assign(new Error("Unsupported week response headers"), { reason: "unsupported-contract" });
          }
          let payload;
          try {
            payload = await response.json();
          } catch {
            throw Object.assign(new Error("Invalid week capability JSON"), { reason: "invalid-json" });
          }
          const bodyDeployment = readRankingDeployment(payload);
          const bodyMetadataMatchesHeaders = deploymentMetadataExactlyMatches(headerDeployment, bodyDeployment);
          updateRequestDiagnostic({
            metadataMatchesHeaders: bodyMetadataMatchesHeaders,
            receivedBodyDeployment: publicDeployment(bodyDeployment),
          });
          const validated = validateResponse(payload, requests);
          updateRequestDiagnostic({
            contractCompatible: true,
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
          && requestAuthorityKey === context.authorityKey
          && reachabilityGeneration === connection().reachabilityGeneration
          && isSupportedLauncherApiVersion(connection().deployment?.apiVersion);
        if (stillCurrent) {
          for (const result of results) {
            await cache.remember(authorityContext(), result);
            const outcome = { checkedAt: result.checkedAt, reason: result.reason, runId, status: "updated" };
            lastResults.set(result.weekId, outcome);
            runResults.set(result.weekId, outcome);
          }
          updateRequestDiagnostic({ reason: null, result: "updated" });
          lastAttemptResult = "updated";
          lastSuccessAt = new Date(now()).toISOString();
          resetRetry();
        } else {
          for (const weekId of requestedIds) {
            const outcome = { checkedAt: new Date(now()).toISOString(), reason: "stale-context", runId, status: "stale" };
            lastResults.set(weekId, outcome);
            runResults.set(weekId, outcome);
          }
          updateRequestDiagnostic({ reason: "stale-context", result: "stale" });
          lastAttemptResult = "stale";
        }
      } catch (error) {
        const failure = abortedRequestReason(activeController.signal) || String(error?.reason || "temporary-failure");
        const checkedAt = new Date(now()).toISOString();
        updateRequestDiagnostic({
          checkedAt,
          contractCompatible: failure === "unsupported-contract" ? false : requestDiagnostic.contractCompatible,
          contractValidation: ["invalid-json", "invalid-response", "unsupported-contract"].includes(failure) ? "invalid" : requestDiagnostic.contractValidation,
          reason: failure,
          result: "failed",
        });
        for (const weekId of requestedIds) {
          const outcome = { checkedAt, reason: failure, runId, status: failure === "stale-context" ? "stale" : "failed" };
          lastResults.set(weekId, outcome);
          runResults.set(weekId, outcome);
        }
        lastAttemptResult = failure === "stale-context" ? "stale" : "failed";
        if (lastAttemptResult === "failed") {
          lastFailureAt = checkedAt;
          lastFailureReason = failure;
          scheduleRetry(failure);
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

  function setSuspended(value) {
    const next = value === true;
    if (next === suspended) return snapshot();
    suspended = next;
    if (suspended) {
      clearBoundaryTimer();
      controller?.abort("suspend");
    } else {
      scheduleBoundary();
    }
    return snapshot();
  }

  return {
    getAuthorityContext: () => ({ authorityKey: context.authorityKey, origin: context.webBaseUrl }),
    getCapability,
    getDiagnostics: () => ({
      authority: {
        key: context.authorityKey,
        origin: context.webBaseUrl,
      },
      cache: cache.diagnostics?.() || null,
      cachePath: cache.path,
      capabilities: Object.fromEntries(context.weekIds.map((weekId) => [weekId, getCapability(weekId)])),
      context: {
        authorityKey: context.authorityKey,
        fingerprint: context.fingerprint,
        generation: context.generation,
        webBaseUrl: context.webBaseUrl,
        weekCount: context.weekIds.length,
      },
      deployment: {
        generation: Number(connection().deploymentGeneration) || 0,
        metadata: publicDeployment(context.observedDeployment),
        metadataChanges: deploymentMetadataChanges,
      },
      inFlight: Boolean(inFlight),
      lastAttemptAt,
      lastAttemptResult,
      lastAttemptTrigger,
      lastFailureAt,
      lastFailureReason,
      lastRequest,
      lastPreflight,
      lastSuccessAt,
      retryAttempt,
      retryScheduledAt: Number.isFinite(retryScheduledAt) ? new Date(retryScheduledAt).toISOString() : null,
      suspended,
      timerActive: boundaryTimer !== null,
    }),
    getState: snapshot,
    initialize,
    ensureFreshCapability,
    refresh,
    setSuspended,
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
