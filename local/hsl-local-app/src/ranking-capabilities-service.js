const {
  isStableConnected,
  normalizeWebBaseUrl,
} = require("./connectivity-service");
const {
  deploymentFingerprintsMatch,
  deploymentKey,
  readHealthDeployment,
  readRankingDeployment,
} = require("./deployment-fingerprint");

const RANKING_CAPABILITIES_PATH = "/api/launcher/ranking-capabilities";
const RANKING_CONTRACT_VERSION = 1;
const DEFAULT_RANKING_CAPABILITIES_OPTIONS = Object.freeze({
  availableTtlMs: 5 * 60 * 1000,
  batchLimit: 100,
  requestTimeoutMs: 4 * 1000,
  softStaleGraceMs: 60 * 1000,
  transitionLimit: 75,
  unavailableTtlMs: 2 * 60 * 1000,
  unknownTtlMs: 20 * 1000,
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
  const config = {
    ...DEFAULT_RANKING_CAPABILITIES_OPTIONS,
    ...(options.config || {}),
  };
  const nowImpl = options.now || Date.now;
  const setTimeoutImpl = options.setTimeout || setTimeout;
  const clearTimeoutImpl = options.clearTimeout || clearTimeout;
  const listeners = new Set();
  const cache = new Map();
  let context = {
    fingerprint: "",
    generation: 0,
    activeInstanceKey: null,
    webBaseUrl: null,
    weekIds: [],
  };
  let inFlight = null;
  let activeController = null;
  let pendingIds = new Set();
  let refreshTimer = null;
  let disposed = false;
  let requestGeneration = 0;
  let stateSequence = 0;
  let previousEntries = {};
  const transitions = [];
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
    return options.getConnectivityState();
  }

  function canQuery() {
    return isStableConnected(connectivityState());
  }

  function cacheKey(weekId) {
    return `${context.webBaseUrl || "missing"}|${deploymentKey(connectivityState().deployment)}|${context.activeInstanceKey || "none"}|${weekId}`;
  }

  function entryFor(weekId) {
    if (!validWeekId(weekId)) {
      return {
        weekId: null,
        status: "unavailable",
        url: null,
        reason: "not-configured",
        checkedAt: null,
        expiresAt: null,
        contractVersion: RANKING_CONTRACT_VERSION,
      };
    }

    const cached = cache.get(cacheKey(weekId));
    const connected = canQuery();

    if (cached && cached.expiresAtMs > nowImpl()) {
      return {
        ...cached,
        expiresAtMs: undefined,
        freshness: pendingIds.has(weekId) ? "revalidating" : "fresh",
        revalidating: pendingIds.has(weekId),
      };
    }

    if (cached?.status === "available" && connected && cached.hardExpiresAtMs > nowImpl()) {
      return {
        ...cached,
        expiresAtMs: undefined,
        hardExpiresAtMs: undefined,
        freshness: pendingIds.has(weekId) ? "revalidating" : "soft-stale",
        revalidating: pendingIds.has(weekId),
      };
    }

    return {
      weekId,
      status: connected && (pendingIds.has(weekId) || !cached) ? "checking" : "unknown",
      url: null,
      reason: cached ? "expired" : "not-checked",
      checkedAt: cached?.checkedAt || null,
      expiresAt: cached?.expiresAt || null,
      contractVersion: RANKING_CONTRACT_VERSION,
      deployment: { ...(connectivityState().deployment || {}) },
      deploymentGeneration: connectivityState().deploymentGeneration || 0,
      freshness: cached ? "hard-expired" : "missing",
      revalidating: pendingIds.has(weekId),
    };
  }

  function cacheSummary() {
    const entries = [...cache.values()];
    return {
      entries: entries.length,
      available: entries.filter((item) => item.status === "available").length,
      unavailable: entries.filter((item) => item.status === "unavailable").length,
      unknown: entries.filter((item) => item.status === "unknown").length,
      expired: entries.filter((item) => item.expiresAtMs <= nowImpl()).length,
    };
  }

  function snapshot() {
    return {
      contractVersion: RANKING_CONTRACT_VERSION,
      generation: context.generation,
      contextGeneration: context.generation,
      inFlight: Boolean(inFlight),
      requestGeneration,
      stateSequence,
      webBaseUrl: context.webBaseUrl,
      entries: Object.fromEntries(context.weekIds.map((weekId) => [weekId, entryFor(weekId)])),
      cache: cacheSummary(),
    };
  }

  function emit(trigger = "state-change") {
    stateSequence += 1;
    const value = snapshot();
    for (const [weekId, next] of Object.entries(value.entries)) {
      const previous = previousEntries[weekId];
      if (!previous || previous.status !== next.status || previous.reason !== next.reason || previous.freshness !== next.freshness) {
        transitions.push({
          activePackInstanceKey: context.activeInstanceKey,
          activeWeekId: weekId,
          cache: next.freshness || "unknown",
          checkedAt: next.checkedAt || null,
          contextGeneration: context.generation,
          deploymentGeneration: connectivityState().deploymentGeneration || 0,
          expiresAt: next.expiresAt || null,
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

  function clearRefreshTimer() {
    if (refreshTimer !== null) {
      clearTimeoutImpl(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (disposed || !canQuery()) return;
    const expirations = context.weekIds
      .map((weekId) => {
        const cached = cache.get(cacheKey(weekId));
        return cached?.nextRefreshAtMs || cached?.expiresAtMs;
      })
      .filter(Number.isFinite);

    if (expirations.length === 0) return;
    const delay = Math.max(0, Math.min(...expirations) - nowImpl());
    refreshTimer = setTimeoutImpl(() => {
      refreshTimer = null;
      refresh("ttl-expired");
    }, delay);
  }

  function writeEntry(weekId, status, reason, url = null) {
    const ttl = status === "available"
      ? config.availableTtlMs
      : status === "unavailable"
        ? config.unavailableTtlMs
        : config.unknownTtlMs;
    const checkedAtMs = nowImpl();
    cache.set(cacheKey(weekId), {
      weekId,
      status,
      url,
      reason,
      checkedAt: new Date(checkedAtMs).toISOString(),
      expiresAt: new Date(checkedAtMs + ttl).toISOString(),
      expiresAtMs: checkedAtMs + ttl,
      hardExpiresAtMs: checkedAtMs + ttl + config.softStaleGraceMs,
      nextRefreshAtMs: null,
      contractVersion: RANKING_CONTRACT_VERSION,
    });
  }

  function staleWeekIds(weekIds, force) {
    return weekIds.filter((weekId) => {
      if (force) return true;
      const cached = cache.get(cacheKey(weekId));
      return !cached || (cached.expiresAtMs <= nowImpl() && (!cached.nextRefreshAtMs || cached.nextRefreshAtMs <= nowImpl()));
    });
  }

  function splitBatches(values) {
    const batches = [];
    for (let index = 0; index < values.length; index += config.batchLimit) {
      batches.push(values.slice(index, index + config.batchLimit));
    }
    return batches;
  }

  function validateBatchResponse(payload, requests, webBaseUrl, expectedDeployment) {
    if (!payload || payload.version !== RANKING_CONTRACT_VERSION || !Array.isArray(payload.results)) {
      throw Object.assign(new Error("Invalid ranking response"), { reason: "invalid-response" });
    }

    const responseDeployment = readRankingDeployment(payload);
    if (!deploymentFingerprintsMatch(expectedDeployment, responseDeployment)) {
      throw Object.assign(new Error("Ranking deployment differs from health"), {
        reason: "deployment-mismatch",
        responseDeployment,
      });
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

      if (result.status === "available" && !url) {
        throw Object.assign(new Error("Unsafe ranking URL"), { reason: "unsafe-url" });
      }

      return {
        weekId: request.weekId,
        status: result.status,
        reason: typeof result.reason === "string" ? result.reason : "server-result",
        url,
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

  function refresh(reason = "manual", refreshOptions = {}) {
    if (disposed || !canQuery()) {
      emit(reason);
      return Promise.resolve(snapshot());
    }

    if (inFlight) return inFlight;

    const requestedWeekIds = Array.isArray(refreshOptions.weekIds)
      ? refreshOptions.weekIds.filter((weekId) => context.weekIds.includes(weekId))
      : context.weekIds;
    const weekIds = staleWeekIds(requestedWeekIds, Boolean(refreshOptions.force));
    const endpoint = rankingCapabilitiesEndpoint(context.webBaseUrl);

    if (!endpoint || weekIds.length === 0) {
      scheduleRefresh();
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
    emit(`${reason}:start`);
    const timeout = setTimeoutImpl(() => controller.abort(), config.requestTimeoutMs);

    inFlight = (async () => {
      try {
        const batches = splitBatches(weekIds);
        const allResults = [];

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const requests = batches[batchIndex].map((weekId, index) => ({
            requestKey: `r-${batchIndex}-${index}`,
            weekId,
          }));
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

          if (!headersMatchHealth) {
            throw Object.assign(new Error("Ranking headers differ from health"), {
              reason: "deployment-mismatch",
              responseDeployment: responseHeaderDeployment,
            });
          }

          if (!response.ok) {
            const errorCode = await safeServiceErrorCode(response);
            lastRequest = { ...lastRequest, errorCode };
            throw Object.assign(new Error("Ranking endpoint unavailable"), {
              errorCode,
              reason: `http-${response.status}`,
            });
          }

          const payload = await response.json();
          const validated = validateBatchResponse(payload, requests, requestBaseUrl, requestDeployment);
          if (!deploymentFingerprintsMatch(responseHeaderDeployment, validated.deployment)) {
            throw Object.assign(new Error("Ranking body differs from response headers"), {
              reason: "deployment-mismatch",
              responseDeployment: validated.deployment,
            });
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

        if (disposed || requestContextGeneration !== context.generation || currentRequestGeneration !== requestGeneration || requestBaseUrl !== context.webBaseUrl ||
            requestReachabilityGeneration !== connectivityState().reachabilityGeneration ||
            requestDeploymentGeneration !== (connectivityState().deploymentGeneration || 0) || !canQuery()) {
          return snapshot();
        }

        for (const result of allResults) {
          writeEntry(result.weekId, result.status, result.reason, result.url);
        }

      } catch (error) {
        const connectivityUnchanged = requestReachabilityGeneration === connectivityState().reachabilityGeneration &&
          requestDeploymentGeneration === (connectivityState().deploymentGeneration || 0);

        if (!disposed && requestContextGeneration === context.generation && currentRequestGeneration === requestGeneration && requestBaseUrl === context.webBaseUrl && connectivityUnchanged) {
          for (const weekId of weekIds) {
            const key = cacheKey(weekId);
            const cached = cache.get(key);
            if (cached?.status === "available" && cached.hardExpiresAtMs > nowImpl()) {
              cache.set(key, {
                ...cached,
                lastError: error?.reason || "temporary-failure",
                nextRefreshAtMs: nowImpl() + config.unknownTtlMs,
              });
            } else {
              writeEntry(weekId, "unknown", error?.reason || "temporary-failure");
            }
          }

          const reason = String(error?.reason || "temporary-failure");

          if (reason === "deployment-mismatch") {
            lastRequest = {
              ...lastRequest,
              build: error?.responseDeployment?.build || "unknown",
              contractVersion: error?.responseDeployment?.apiVersion || null,
              deploymentMatchesHealth: false,
              environment: error?.responseDeployment?.environment || "unknown",
            };
          }

          if (!reason.startsWith("http-") || !lastRequest.checkedAt) {
            lastRequest = {
              ...lastRequest,
              checkedAt: new Date(nowImpl()).toISOString(),
              errorCode: error?.errorCode || null,
              httpStatus: reason === "temporary-failure" || controller.signal.aborted ? null : lastRequest.httpStatus,
              reason: controller.signal.aborted ? "timeout" : reason,
            };
          }

          if (controller.signal.aborted || reason === "temporary-failure") {
            options.onTransportFailure?.("ranking-capabilities");
          }
        }
      } finally {
        clearTimeoutImpl(timeout);
        if (requestContextGeneration === context.generation && currentRequestGeneration === requestGeneration) {
          inFlight = null;
          activeController = null;
          pendingIds = new Set();
          emit(`${reason}:complete`);
          scheduleRefresh();
        }
      }

      return snapshot();
    })();

    return inFlight;
  }

  function updateContext(input = {}) {
    const webBaseUrl = normalizeWebBaseUrl(input.webBaseUrl);
    const weekIds = [...new Set((input.packs || []).map((pack) => pack?.weekId).filter(validWeekId))].sort();
    const activeInstanceKey = String(input.activeInstanceKey || "");
    const fingerprint = `${webBaseUrl || "missing"}|${activeInstanceKey}|${weekIds.join("|")}`;

    if (fingerprint === context.fingerprint) return snapshot();
    context = {
      fingerprint,
      generation: context.generation + 1,
      activeInstanceKey,
      webBaseUrl,
      weekIds,
    };
    activeController?.abort();
    activeController = null;
    inFlight = null;
    pendingIds = new Set();
    clearRefreshTimer();
    requestGeneration += 1;
    emit("context-change");
    return snapshot();
  }

  async function ensureCapability(weekId) {
    if (!validWeekId(weekId)) return entryFor(null);
    const current = entryFor(weekId);
    if ((current.status === "available" && current.freshness === "fresh") || current.status === "unavailable") return current;
    const checkedAt = current.checkedAt;
    await refresh("ranking-click", { force: true, weekIds: [weekId] });
    const refreshed = entryFor(weekId);
    if (refreshed.status === "available" && refreshed.checkedAt === checkedAt && refreshed.freshness !== "fresh") {
      return { ...refreshed, status: "unknown", reason: "revalidation-failed", url: null };
    }
    return refreshed;
  }

  function stop() {
    disposed = true;
    context.generation += 1;
    activeController?.abort();
    clearRefreshTimer();
    pendingIds = new Set();
    listeners.clear();
  }

  return {
    config,
    ensureCapability,
    getCapability: entryFor,
    getDiagnostics(activeWeekId = null) {
      return {
        activeWeekId,
        active: activeWeekId ? entryFor(activeWeekId) : null,
        cache: cacheSummary(),
        endpoint: rankingCapabilitiesEndpoint(context.webBaseUrl),
        configurationAvailable: Boolean(rankingCapabilitiesEndpoint(context.webBaseUrl)),
        lastRequest: { ...lastRequest },
        context: {
          activeInstanceKey: context.activeInstanceKey,
          contractVersion: RANKING_CONTRACT_VERSION,
          generation: context.generation,
          inFlight: Boolean(inFlight),
          weekCount: context.weekIds.length,
          webBaseUrl: context.webBaseUrl,
        },
        stateSequence,
        transitions: transitions.map((item) => ({ ...item })),
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
