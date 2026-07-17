const { isCommittedConnected, normalizeWebBaseUrl } = require("./connectivity-service");
const {
  deploymentFingerprintsMatch,
  deploymentKey,
  readHealthDeployment,
  readRankingDeployment,
} = require("./deployment-fingerprint");

const RANKING_CAPABILITIES_PATH = "/api/launcher/ranking-capabilities";
const RANKING_CONTRACT_VERSION = 1;
const DEFAULT_RANKING_CAPABILITIES_OPTIONS = Object.freeze({
  batchLimit: 100,
  requestTimeoutMs: 4 * 1000,
  transitionLimit: 75,
  unknownRetryDelaysMs: Object.freeze([20 * 1000, 60 * 1000, 2 * 60 * 1000]),
});
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;

function rankingCapabilitiesEndpoint(webBaseUrl) {
  const normalized = normalizeWebBaseUrl(webBaseUrl);
  return normalized ? new URL(RANKING_CAPABILITIES_PATH, `${normalized}/`).toString() : null;
}

function safeRankingUrl(value, webBaseUrl) {
  const normalized = normalizeWebBaseUrl(webBaseUrl);
  if (!normalized) return null;
  try {
    const candidate = new URL(String(value || ""));
    const allowed = new URL(normalized);
    return ["http:", "https:"].includes(candidate.protocol) && candidate.origin === allowed.origin
      ? candidate.toString()
      : null;
  } catch {
    return null;
  }
}

function validWeekId(value) {
  return typeof value === "string" && identifierPattern.test(value);
}

function createRankingCapabilitiesService(options = {}) {
  const config = { ...DEFAULT_RANKING_CAPABILITIES_OPTIONS, ...(options.config || {}) };
  const nowImpl = options.now || Date.now;
  const setTimeoutImpl = options.setTimeout || setTimeout;
  const clearTimeoutImpl = options.clearTimeout || clearTimeout;
  const listeners = new Set();
  const cache = new Map();
  const transitions = [];
  let context = {
    deploymentKey: deploymentKey(options.getConnectivityState()?.deployment),
    fingerprint: "",
    generation: 0,
    webBaseUrl: null,
    weekIds: [],
  };
  let inFlight = null;
  let activeController = null;
  let pendingIds = new Set();
  let retryTimer = null;
  let disposed = false;
  let requestGeneration = 0;
  let stateSequence = 0;
  let previousEntries = {};
  let initialBatchAt = null;
  let lastForcedRefreshAt = null;
  let lastRequest = {
    build: "unknown",
    checkedAt: null,
    contractVersion: null,
    deploymentMatchesHealth: null,
    environment: "unknown",
    errorCode: null,
    httpStatus: null,
    reason: "not-checked",
  };

  function connectivityState() {
    return options.getConnectivityState() || {};
  }

  function canQuery() {
    return isCommittedConnected(connectivityState());
  }

  function cacheKey(weekId) {
    return `${context.webBaseUrl || "missing"}|${context.deploymentKey}|${weekId}`;
  }

  function publicEntry(entry, overrides = {}) {
    return {
      ...entry,
      nextRetryAtMs: undefined,
      retryAttempt: undefined,
      verificationMode: "session",
      ...overrides,
    };
  }

  function entryFor(weekId) {
    if (!validWeekId(weekId)) {
      return {
        checkedAt: null,
        contractVersion: RANKING_CONTRACT_VERSION,
        reason: "not-configured",
        status: "unavailable",
        url: null,
        verificationMode: "session",
        weekId: null,
      };
    }
    const cached = cache.get(cacheKey(weekId));
    if (cached) return publicEntry(cached, { revalidating: pendingIds.has(weekId) });
    return {
      checkedAt: null,
      contractVersion: RANKING_CONTRACT_VERSION,
      deployment: { ...(connectivityState().deployment || {}) },
      deploymentGeneration: connectivityState().deploymentGeneration || 0,
      reason: "not-checked",
      revalidating: pendingIds.has(weekId),
      status: canQuery() && pendingIds.has(weekId) ? "checking" : "unknown",
      url: null,
      verificationMode: "session",
      weekId,
    };
  }

  function currentEntries() {
    return context.weekIds.map((weekId) => entryFor(weekId));
  }

  function cacheSummary() {
    const entries = currentEntries();
    return {
      entries: entries.length,
      available: entries.filter((item) => item.status === "available").length,
      unavailable: entries.filter((item) => item.status === "unavailable").length,
      unknown: entries.filter((item) => ["unknown", "checking"].includes(item.status)).length,
    };
  }

  function snapshot() {
    return {
      automaticTtlRefresh: false,
      cache: cacheSummary(),
      contextFingerprint: context.fingerprint,
      contextGeneration: context.generation,
      contractVersion: RANKING_CONTRACT_VERSION,
      entries: Object.fromEntries(context.weekIds.map((weekId) => [weekId, entryFor(weekId)])),
      generation: context.generation,
      inFlight: Boolean(inFlight),
      requestGeneration,
      stateSequence,
      verificationMode: "session",
      webBaseUrl: context.webBaseUrl,
    };
  }

  function emit(trigger = "state-change") {
    stateSequence += 1;
    const value = snapshot();
    for (const [weekId, next] of Object.entries(value.entries)) {
      const previous = previousEntries[weekId];
      if (!previous || previous.status !== next.status || previous.reason !== next.reason || previous.revalidating !== next.revalidating) {
        transitions.push({
          activeWeekId: weekId,
          cache: next.status,
          checkedAt: next.checkedAt || null,
          contextGeneration: context.generation,
          deploymentGeneration: connectivityState().deploymentGeneration || 0,
          inFlight: Boolean(inFlight),
          nextReason: next.reason || null,
          nextStatus: next.status,
          previousReason: previous?.reason || null,
          previousStatus: previous?.status || null,
          reachabilityGeneration: connectivityState().reachabilityGeneration || 0,
          requestGeneration,
          sequence: stateSequence,
          timestamp: new Date(nowImpl()).toISOString(),
          trigger,
        });
      }
    }
    if (transitions.length > config.transitionLimit) transitions.splice(0, transitions.length - config.transitionLimit);
    previousEntries = value.entries;
    for (const listener of listeners) listener(value);
  }

  function clearRetryTimer() {
    if (retryTimer !== null) clearTimeoutImpl(retryTimer);
    retryTimer = null;
  }

  function scheduleUnknownRetry() {
    clearRetryTimer();
    if (disposed || !canQuery()) return;
    const retryTimes = context.weekIds
      .map((weekId) => cache.get(cacheKey(weekId)))
      .filter((entry) => entry?.status === "unknown" && Number.isFinite(entry.nextRetryAtMs))
      .map((entry) => entry.nextRetryAtMs);
    if (retryTimes.length === 0) return;
    retryTimer = setTimeoutImpl(() => {
      retryTimer = null;
      refresh("unknown-retry");
    }, Math.max(0, Math.min(...retryTimes) - nowImpl()));
  }

  function writeConclusive(result) {
    cache.set(cacheKey(result.weekId), {
      checkedAt: new Date(nowImpl()).toISOString(),
      contractVersion: RANKING_CONTRACT_VERSION,
      reason: result.reason,
      status: result.status,
      url: result.url,
      weekId: result.weekId,
    });
  }

  function writeUnknown(weekId, reason) {
    const key = cacheKey(weekId);
    const previous = cache.get(key);
    if (["available", "unavailable"].includes(previous?.status)) return;
    const retryAttempt = (Number(previous?.retryAttempt) || 0) + 1;
    const retryDelay = config.unknownRetryDelaysMs[retryAttempt - 1];
    cache.set(key, {
      checkedAt: new Date(nowImpl()).toISOString(),
      contractVersion: RANKING_CONTRACT_VERSION,
      nextRetryAtMs: Number.isFinite(retryDelay) ? nowImpl() + retryDelay : null,
      reason,
      retryAttempt,
      status: "unknown",
      url: null,
      weekId,
    });
  }

  function requestedWeekIds(values, force) {
    return values.filter((weekId) => {
      const cached = cache.get(cacheKey(weekId));
      if (force) return true;
      if (!cached) return true;
      return cached.status === "unknown" && Number.isFinite(cached.nextRetryAtMs) && cached.nextRetryAtMs <= nowImpl();
    });
  }

  function splitBatches(values) {
    const batches = [];
    for (let index = 0; index < values.length; index += config.batchLimit) batches.push(values.slice(index, index + config.batchLimit));
    return batches;
  }

  function validateBatchResponse(payload, requests, webBaseUrl, expectedDeployment) {
    if (!payload || payload.version !== RANKING_CONTRACT_VERSION || !Array.isArray(payload.results)) {
      throw Object.assign(new Error("Invalid ranking response"), { reason: "invalid-response" });
    }
    const responseDeployment = readRankingDeployment(payload);
    if (!deploymentFingerprintsMatch(expectedDeployment, responseDeployment)) {
      throw Object.assign(new Error("Ranking deployment differs from health"), { reason: "deployment-mismatch", responseDeployment });
    }
    const byRequestKey = new Map(payload.results.map((item) => [item?.requestKey, item]));
    return {
      deployment: responseDeployment,
      results: requests.map((request) => {
        const result = byRequestKey.get(request.requestKey);
        if (!result || !["available", "unavailable"].includes(result.status)) {
          throw Object.assign(new Error("Incomplete ranking response"), { reason: "invalid-response" });
        }
        const url = result.status === "available" ? safeRankingUrl(result.url, webBaseUrl) : null;
        if (result.status === "available" && !url) throw Object.assign(new Error("Unsafe ranking URL"), { reason: "unsafe-url" });
        return {
          reason: typeof result.reason === "string" ? result.reason : "server-result",
          status: result.status,
          url,
          weekId: request.weekId,
        };
      }),
    };
  }

  async function safeServiceErrorCode(response) {
    try {
      const payload = await response.json();
      const code = String(payload?.code || "");
      return /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }

  function refresh(reason = "context", refreshOptions = {}) {
    if (disposed || !canQuery()) {
      emit(reason);
      return Promise.resolve(snapshot());
    }
    if (inFlight) return inFlight;
    const candidates = Array.isArray(refreshOptions.weekIds)
      ? refreshOptions.weekIds.filter((weekId) => context.weekIds.includes(weekId))
      : context.weekIds;
    const retryUnknownNow = ["connectivity-restored", "deployment-change"].includes(reason);
    const weekIds = requestedWeekIds(candidates, Boolean(refreshOptions.force) || retryUnknownNow);
    const endpoint = rankingCapabilitiesEndpoint(context.webBaseUrl);
    if (!endpoint || weekIds.length === 0) {
      scheduleUnknownRetry();
      return Promise.resolve(snapshot());
    }

    const requestContextGeneration = context.generation;
    const currentRequestGeneration = ++requestGeneration;
    const requestBaseUrl = context.webBaseUrl;
    const requestReachabilityGeneration = connectivityState().reachabilityGeneration;
    const requestDeploymentGeneration = connectivityState().deploymentGeneration || 0;
    const requestDeployment = { ...(connectivityState().deployment || {}) };
    const controller = new AbortController();
    activeController = controller;
    pendingIds = new Set(weekIds);
    if (!initialBatchAt) initialBatchAt = new Date(nowImpl()).toISOString();
    if (refreshOptions.force) lastForcedRefreshAt = new Date(nowImpl()).toISOString();
    emit(`${reason}:start`);
    const timeout = setTimeoutImpl(() => controller.abort(), config.requestTimeoutMs);

    inFlight = (async () => {
      try {
        const allResults = [];
        const batches = splitBatches(weekIds);
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const requests = batches[batchIndex].map((weekId, index) => ({ requestKey: `r-${batchIndex}-${index}`, weekId }));
          const response = await options.fetchImpl(endpoint, {
            body: JSON.stringify({ version: RANKING_CONTRACT_VERSION, requests }),
            cache: "no-store",
            headers: { "content-type": "application/json" },
            method: "POST",
            redirect: "manual",
            signal: controller.signal,
          });
          options.onReachable?.("ranking-capabilities-response");
          const responseHeaderDeployment = readHealthDeployment(response);
          const headersMatchHealth = deploymentFingerprintsMatch(requestDeployment, responseHeaderDeployment);
          lastRequest = {
            build: responseHeaderDeployment.build,
            checkedAt: new Date(nowImpl()).toISOString(),
            contractVersion: responseHeaderDeployment.apiVersion,
            deploymentMatchesHealth: headersMatchHealth,
            environment: responseHeaderDeployment.environment,
            errorCode: null,
            httpStatus: response.status,
            reason: response.ok ? null : `http-${response.status}`,
          };
          if (!headersMatchHealth) throw Object.assign(new Error("Ranking headers differ from health"), { reason: "deployment-mismatch", responseDeployment: responseHeaderDeployment });
          if (!response.ok) {
            const errorCode = await safeServiceErrorCode(response);
            lastRequest = { ...lastRequest, errorCode };
            throw Object.assign(new Error("Ranking endpoint unavailable"), { errorCode, reason: `http-${response.status}` });
          }
          const validated = validateBatchResponse(await response.json(), requests, requestBaseUrl, requestDeployment);
          if (!deploymentFingerprintsMatch(responseHeaderDeployment, validated.deployment)) {
            throw Object.assign(new Error("Ranking body differs from response headers"), { reason: "deployment-mismatch", responseDeployment: validated.deployment });
          }
          lastRequest = {
            ...lastRequest,
            build: validated.deployment.build,
            contractVersion: validated.deployment.apiVersion,
            deploymentMatchesHealth: true,
            environment: validated.deployment.environment,
          };
          allResults.push(...validated.results);
        }
        if (disposed || requestContextGeneration !== context.generation || currentRequestGeneration !== requestGeneration ||
            requestBaseUrl !== context.webBaseUrl || requestReachabilityGeneration !== connectivityState().reachabilityGeneration ||
            requestDeploymentGeneration !== (connectivityState().deploymentGeneration || 0) || !canQuery()) return snapshot();
        for (const result of allResults) writeConclusive(result);
      } catch (error) {
        const unchanged = requestContextGeneration === context.generation && currentRequestGeneration === requestGeneration &&
          requestBaseUrl === context.webBaseUrl && requestReachabilityGeneration === connectivityState().reachabilityGeneration &&
          requestDeploymentGeneration === (connectivityState().deploymentGeneration || 0);
        if (!disposed && unchanged) {
          const failureReason = controller.signal.aborted ? "timeout" : String(error?.reason || "temporary-failure");
          for (const weekId of weekIds) writeUnknown(weekId, failureReason);
          if (failureReason === "deployment-mismatch") {
            lastRequest = {
              ...lastRequest,
              build: error?.responseDeployment?.build || "unknown",
              contractVersion: error?.responseDeployment?.apiVersion || null,
              deploymentMatchesHealth: false,
              environment: error?.responseDeployment?.environment || "unknown",
            };
          }
          if (!failureReason.startsWith("http-") || !lastRequest.checkedAt) {
            lastRequest = {
              ...lastRequest,
              checkedAt: new Date(nowImpl()).toISOString(),
              errorCode: error?.errorCode || null,
              httpStatus: null,
              reason: failureReason,
            };
          }
          if (controller.signal.aborted || failureReason === "temporary-failure") options.onTransportFailure?.("ranking-capabilities");
        }
      } finally {
        clearTimeoutImpl(timeout);
        if (requestContextGeneration === context.generation && currentRequestGeneration === requestGeneration) {
          inFlight = null;
          activeController = null;
          pendingIds = new Set();
          emit(`${reason}:complete`);
          scheduleUnknownRetry();
        }
      }
      return snapshot();
    })();
    return inFlight;
  }

  function replaceContext(next) {
    context = { ...next, generation: context.generation + 1 };
    activeController?.abort();
    activeController = null;
    inFlight = null;
    pendingIds = new Set();
    clearRetryTimer();
    requestGeneration += 1;
    emit("context-change");
    return snapshot();
  }

  function updateContext(input = {}) {
    const webBaseUrl = normalizeWebBaseUrl(input.webBaseUrl);
    const weekIds = [...new Set((input.packs || []).map((pack) => pack?.weekId).filter(validWeekId))].sort();
    const currentDeploymentKey = deploymentKey(connectivityState().deployment);
    const fingerprint = `${webBaseUrl || "missing"}|${currentDeploymentKey}|${weekIds.join("|")}`;
    if (fingerprint === context.fingerprint) return snapshot();
    return replaceContext({ deploymentKey: currentDeploymentKey, fingerprint, webBaseUrl, weekIds });
  }

  function updateDeployment() {
    const currentDeploymentKey = deploymentKey(connectivityState().deployment);
    if (currentDeploymentKey === context.deploymentKey) return snapshot();
    const fingerprint = `${context.webBaseUrl || "missing"}|${currentDeploymentKey}|${context.weekIds.join("|")}`;
    return replaceContext({ ...context, deploymentKey: currentDeploymentKey, fingerprint });
  }

  async function ensureCapability(weekId) {
    return entryFor(validWeekId(weekId) ? weekId : null);
  }

  function stop() {
    disposed = true;
    context.generation += 1;
    activeController?.abort();
    clearRetryTimer();
    pendingIds = new Set();
    listeners.clear();
  }

  return {
    config,
    ensureCapability,
    forceRefresh: () => refresh("development-force", { force: true }),
    getCapability: entryFor,
    getDiagnostics(activeWeekId = null) {
      const entries = currentEntries();
      return {
        activeWeekId,
        active: activeWeekId ? entryFor(activeWeekId) : null,
        automaticTtlRefresh: false,
        available: entries.filter((item) => item.status === "available").map((item) => item.weekId),
        cache: cacheSummary(),
        checkedWeekIds: entries.filter((item) => ["available", "unavailable"].includes(item.status)).map((item) => item.weekId),
        configurationAvailable: Boolean(rankingCapabilitiesEndpoint(context.webBaseUrl)),
        context: {
          contractVersion: RANKING_CONTRACT_VERSION,
          deployment: context.deploymentKey,
          fingerprint: context.fingerprint,
          generation: context.generation,
          inFlight: Boolean(inFlight),
          weekCount: context.weekIds.length,
          webBaseUrl: context.webBaseUrl,
        },
        endpoint: rankingCapabilitiesEndpoint(context.webBaseUrl),
        initialBatchAt,
        lastForcedRefreshAt,
        lastRequest: { ...lastRequest },
        retryPending: retryTimer !== null,
        stateSequence,
        transitions: transitions.map((item) => ({ ...item })),
        unavailable: entries.filter((item) => item.status === "unavailable").map((item) => item.weekId),
        unknown: entries.filter((item) => ["unknown", "checking"].includes(item.status)).map((item) => item.weekId),
        verificationMode: "session",
      };
    },
    getState: snapshot,
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
  DEFAULT_RANKING_CAPABILITIES_OPTIONS,
  RANKING_CAPABILITIES_PATH,
  RANKING_CONTRACT_VERSION,
  createRankingCapabilitiesService,
  rankingCapabilitiesEndpoint,
  safeRankingUrl,
  validWeekId,
};
