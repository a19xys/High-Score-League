const {
  isStableConnected,
  normalizeWebBaseUrl,
} = require("./connectivity-service");

const RANKING_CAPABILITIES_PATH = "/api/launcher/ranking-capabilities";
const RANKING_CONTRACT_VERSION = 1;
const DEFAULT_RANKING_CAPABILITIES_OPTIONS = Object.freeze({
  availableTtlMs: 5 * 60 * 1000,
  batchLimit: 100,
  requestTimeoutMs: 4 * 1000,
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
    webBaseUrl: null,
    weekIds: [],
  };
  let inFlight = null;
  let activeController = null;
  let pendingIds = new Set();
  let refreshTimer = null;
  let disposed = false;
  let lastRequest = {
    checkedAt: null,
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
    return `${context.webBaseUrl || "missing"}|${weekId}`;
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
      return { ...cached, expiresAtMs: undefined };
    }

    return {
      weekId,
      status: connected && (pendingIds.has(weekId) || !cached) ? "checking" : "unknown",
      url: null,
      reason: cached ? "expired" : "not-checked",
      checkedAt: cached?.checkedAt || null,
      expiresAt: cached?.expiresAt || null,
      contractVersion: RANKING_CONTRACT_VERSION,
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
      inFlight: Boolean(inFlight),
      webBaseUrl: context.webBaseUrl,
      entries: Object.fromEntries(context.weekIds.map((weekId) => [weekId, entryFor(weekId)])),
      cache: cacheSummary(),
    };
  }

  function emit() {
    const value = snapshot();
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
      .map((weekId) => cache.get(cacheKey(weekId))?.expiresAtMs)
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
      contractVersion: RANKING_CONTRACT_VERSION,
    });
  }

  function staleWeekIds(weekIds, force) {
    return weekIds.filter((weekId) => {
      if (force) return true;
      const cached = cache.get(cacheKey(weekId));
      return !cached || cached.expiresAtMs <= nowImpl();
    });
  }

  function splitBatches(values) {
    const batches = [];
    for (let index = 0; index < values.length; index += config.batchLimit) {
      batches.push(values.slice(index, index + config.batchLimit));
    }
    return batches;
  }

  function validateBatchResponse(payload, requests, webBaseUrl) {
    if (!payload || payload.version !== RANKING_CONTRACT_VERSION || !Array.isArray(payload.results)) {
      throw Object.assign(new Error("Invalid ranking response"), { reason: "invalid-response" });
    }

    const byRequestKey = new Map(payload.results.map((item) => [item?.requestKey, item]));

    return requests.map((request) => {
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
    });
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
      emit();
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

    const requestGeneration = context.generation;
    const requestBaseUrl = context.webBaseUrl;
    const requestReachabilityGeneration = connectivityState().reachabilityGeneration;
    const controller = new AbortController();
    activeController = controller;
    pendingIds = new Set(weekIds);
    emit();
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
          lastRequest = {
            checkedAt: new Date(nowImpl()).toISOString(),
            errorCode: null,
            httpStatus: response.status,
            reason: response.ok ? null : `http-${response.status}`,
          };

          if (!response.ok) {
            const errorCode = await safeServiceErrorCode(response);
            lastRequest = { ...lastRequest, errorCode };
            throw Object.assign(new Error("Ranking endpoint unavailable"), {
              errorCode,
              reason: `http-${response.status}`,
            });
          }

          const payload = await response.json();
          allResults.push(...validateBatchResponse(payload, requests, requestBaseUrl));
        }

        if (disposed || requestGeneration !== context.generation || requestBaseUrl !== context.webBaseUrl ||
            requestReachabilityGeneration !== connectivityState().reachabilityGeneration || !canQuery()) {
          return snapshot();
        }

        for (const result of allResults) {
          writeEntry(result.weekId, result.status, result.reason, result.url);
        }

      } catch (error) {
        const connectivityUnchanged = requestReachabilityGeneration === connectivityState().reachabilityGeneration;

        if (!disposed && requestGeneration === context.generation && requestBaseUrl === context.webBaseUrl && connectivityUnchanged) {
          for (const weekId of weekIds) {
            writeEntry(weekId, "unknown", error?.reason || "temporary-failure");
          }

          const reason = String(error?.reason || "temporary-failure");

          if (!reason.startsWith("http-") || !lastRequest.checkedAt) {
            lastRequest = {
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
        if (requestGeneration === context.generation) {
          inFlight = null;
          activeController = null;
          pendingIds = new Set();
          emit();
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
    const fingerprint = `${webBaseUrl || "missing"}|${weekIds.join("|")}`;

    if (fingerprint === context.fingerprint) return snapshot();
    context = {
      fingerprint,
      generation: context.generation + 1,
      webBaseUrl,
      weekIds,
    };
    activeController?.abort();
    activeController = null;
    inFlight = null;
    pendingIds = new Set();
    clearRefreshTimer();
    emit();
    return snapshot();
  }

  async function ensureCapability(weekId) {
    if (!validWeekId(weekId)) return entryFor(null);
    const current = entryFor(weekId);
    if (current.status === "available" || current.status === "unavailable") return current;
    await refresh("ranking-click", { force: true, weekIds: [weekId] });
    return entryFor(weekId);
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
          contractVersion: RANKING_CONTRACT_VERSION,
          generation: context.generation,
          inFlight: Boolean(inFlight),
          weekCount: context.weekIds.length,
          webBaseUrl: context.webBaseUrl,
        },
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
