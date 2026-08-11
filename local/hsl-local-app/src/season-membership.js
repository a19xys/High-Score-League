const { resolveCanonicalSessionResult } = require("./auth");
const { executeCanonicalAuthenticatedRequest } = require("./authenticated-request");
const { createMembershipCache } = require("./competitive-authority-cache");
const { normalizeWebBaseUrl, parseResponseText } = require("./submission-http");
const { executeRemoteRequest } = require("./remote-request");
const { parseRetryAfter, RETRYABLE_HTTP_STATUSES } = require("./submission-outcome");
const {
  createSessionResult,
} = require("./session-result");

const NETWORK_STATUSES = new Set(["unknown", "error"]);
const SAFE_BODY_STATUSES = new Set(["member", "not_member", "unauthenticated", "invalid_week", "error", "unknown"]);
const BLOCKING_STATUSES = new Set(["checking", "error", "no_session", "missing_week", "invalid_week", "not_member", "unauthenticated", "unknown"]);
const membershipCaches = new Map();
const PLAYER_MESSAGES = {
  member: "Participas en esta temporada. Puedes jugar competicion.",
  not_member: "No participas en esta temporada. Unete desde la web para competir.",
  no_session: "Inicia sesion para competir.",
  unauthenticated: "La sesion no es valida. Cierra sesion e inicia sesion de nuevo.",
  missing_week: "El pack no tiene weekId. No se puede comprobar la temporada.",
  invalid_week: "No se encontro la semana del pack.",
  error: "La web devolvio un error al comprobar la participacion.",
  unknown: "No se pudo comprobar la participacion.",
};

function getMembershipUrl(config, weekId) {
  return `${normalizeWebBaseUrl(config.webBaseUrl)}/api/local/season-membership?weekId=${encodeURIComponent(weekId)}`;
}

function baseState(overrides = {}) {
  return {
    authDeferred: false,
    canPlayCompetition: false,
    canSubmit: false,
    checkedAt: null,
    joinUrl: null,
    message: "No se pudo comprobar la participacion.",
    request: null,
    remoteFailure: null,
    response: null,
    retryAfterMs: null,
    retryable: false,
    seasonId: null,
    sessionRevision: 0,
    sessionStatus: null,
    status: "unknown",
    technicalReason: null,
    weekId: null,
    ...overrides,
  };
}

function unauthenticatedSessionState(config, weekId, request, sessionResult, options = {}) {
  return baseState({
    checkedAt: options.checkedAt || new Date().toISOString(),
    joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
    message: PLAYER_MESSAGES.unauthenticated,
    request,
    sessionRevision: Number(sessionResult?.sessionRevision) || 0,
    sessionStatus: sessionResult?.status || null,
    status: "unauthenticated",
    technicalReason: `auth-required:${sessionResult?.status || "unknown"}`,
    weekId,
  });
}

function deferredSessionState(config, weekId, sessionResult, options = {}, reason = null) {
  const sessionStatus = sessionResult?.status || "unknown";
  return baseState({
    authDeferred: true,
    canPlayCompetition: false,
    canSubmit: false,
    checkedAt: options.checkedAt || new Date().toISOString(),
    joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
    message: PLAYER_MESSAGES.unknown,
    remoteFailure: sessionStatus === "cancelled" ? "cancelled" : null,
    retryAfterMs: Number(sessionResult?.retryAfterMs) || null,
    retryable: sessionStatus !== "cancelled" && sessionResult?.shouldRetry !== false,
    sessionRevision: Number(sessionResult?.sessionRevision) || 0,
    sessionStatus,
    status: "unknown",
    technicalReason: `auth-deferred:${reason || sessionResult?.reason || sessionStatus}`,
    weekId,
  });
}

async function resolveMembershipSessionResult(config, sessionState, options = {}) {
  if (options.sessionResult !== undefined) return options.sessionResult;
  if (options.trustStoredSessionFixture === true && options.storedSession) {
    return createSessionResult({
      sessionRevision: Number(options.storedSession.sessionRevision) || 0,
      status: "valid",
      storedSession: options.storedSession,
    });
  }
  const resolveImpl = options.resolveCanonicalSessionResultImpl || resolveCanonicalSessionResult;
  return resolveImpl(config, {
    connected: options.connected !== false,
    fetchImpl: options.sessionFetchImpl,
    force: options.forceSessionRefresh === true,
    signal: options.signal,
    timeoutMs: options.sessionTimeoutMs,
    userId: options.userId || sessionState?.userId || undefined,
  });
}

function resolveMembershipJoinUrl(config, joinUrl) {
  const fallback = normalizeWebBaseUrl(config.webBaseUrl || "");
  try {
    const trusted = new URL(fallback);
    const candidate = new URL(typeof joinUrl === "string" && joinUrl.trim() ? joinUrl : fallback, `${fallback}/`);
    const safe = ["http:", "https:"].includes(candidate.protocol) &&
      !candidate.username && !candidate.password && candidate.origin === trusted.origin;
    return { rejected: !safe, url: safe ? candidate.href.replace(/\/$/, candidate.pathname === "/" ? "" : "/") : fallback };
  } catch {
    return { rejected: Boolean(joinUrl), url: fallback };
  }
}

function safeMembershipJoinUrl(config, joinUrl) {
  return resolveMembershipJoinUrl(config, joinUrl).url;
}

function createRequestDetails(config, weekId) {
  if (!config.webBaseUrl || !weekId) {
    return null;
  }

  return {
    method: "GET",
    url: getMembershipUrl(config, weekId),
  };
}

function sanitizeResponseBody(body) {
  if (!body) {
    return {
      bodyMessage: "empty_response",
      bodyOk: null,
      bodyStatus: "empty_response",
      technicalReason: "empty_response",
    };
  }

  if (typeof body.rawText === "string") {
    return {
      bodyLength: body.rawText.length,
      bodyMessage: "non_json_response",
      bodyOk: null,
      bodyStatus: "non_json_response",
      technicalReason: "non_json_response",
    };
  }

  const bodyStatus = SAFE_BODY_STATUSES.has(body.status) ? body.status : typeof body.status === "string" ? "unexpected_status" : null;
  const bodyMessage = typeof body.message === "string" || typeof body.error === "string"
    ? "server_message"
    : null;

  return {
    bodyMessage,
    bodyOk: typeof body.ok === "boolean" ? body.ok : null,
    bodyStatus,
    technicalReason: bodyStatus || bodyMessage || "unexpected_response",
  };
}

function createResponseDetails(response, body) {
  if (!response) {
    return null;
  }

  const sanitized = sanitizeResponseBody(body);

  return {
    bodyMessage: sanitized.bodyMessage,
    bodyOk: sanitized.bodyOk,
    bodyStatus: sanitized.bodyStatus,
    contentType: response.headers?.get?.("content-type") || null,
    httpStatus: response.status,
    ok: response.ok,
  };
}

function getTechnicalReason(responseDetails, fallback = null) {
  if (!responseDetails) {
    return fallback;
  }

  const bodyPart = responseDetails.bodyStatus || responseDetails.bodyMessage || fallback;
  return [`HTTP ${responseDetails.httpStatus}`, bodyPart].filter(Boolean).join(" - ");
}

function normalizeMembershipResponse(config, body, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString();
  const status = typeof body?.status === "string" ? body.status : "unknown";
  const weekId = typeof body?.weekId === "string" ? body.weekId : options.weekId || null;
  const seasonId = typeof body?.seasonId === "string" ? body.seasonId : null;
  const joinUrlResult = resolveMembershipJoinUrl(config, body?.joinUrl);
  const joinUrl = joinUrlResult.url;
  const request = options.request || createRequestDetails(config, weekId);
  const response = options.response || null;
  const technicalReason = options.technicalReason || getTechnicalReason(response);

  if (status === "member") {
    return baseState({
      canPlayCompetition: true,
      canSubmit: true,
      checkedAt,
      joinUrl,
      joinUrlRejected: joinUrlResult.rejected,
      message: PLAYER_MESSAGES.member,
      request,
      response,
      seasonId,
      status,
      technicalReason,
      weekId,
    });
  }

  if (status === "not_member") {
    return baseState({
      checkedAt,
      joinUrl,
      joinUrlRejected: joinUrlResult.rejected,
      message: PLAYER_MESSAGES.not_member,
      request,
      response,
      seasonId,
      status,
      technicalReason,
      weekId,
    });
  }

  if (status === "invalid_week") {
    return baseState({
      checkedAt,
      joinUrl,
      joinUrlRejected: joinUrlResult.rejected,
      message: PLAYER_MESSAGES.invalid_week,
      request,
      response,
      seasonId,
      status,
      technicalReason,
      weekId,
    });
  }

  if (status === "unauthenticated") {
    return baseState({
      checkedAt,
      joinUrl,
      joinUrlRejected: joinUrlResult.rejected,
      message: PLAYER_MESSAGES.unknown,
      request,
      response,
      seasonId,
      status: "unknown",
      technicalReason,
      weekId,
    });
  }

  if (status === "error") {
    return baseState({
      canPlayCompetition: false,
      canSubmit: false,
      checkedAt,
      joinUrl,
      joinUrlRejected: joinUrlResult.rejected,
      message: PLAYER_MESSAGES.error,
      request,
      response,
      seasonId,
      status,
      technicalReason,
      weekId,
    });
  }

  return baseState({
    canPlayCompetition: false,
    canSubmit: false,
    checkedAt,
    joinUrl,
    joinUrlRejected: joinUrlResult.rejected,
    message: PLAYER_MESSAGES.unknown,
    request,
    response,
    seasonId,
    status: NETWORK_STATUSES.has(status) ? status : "unknown",
    technicalReason: technicalReason || sanitizeResponseBody(body).technicalReason,
    weekId,
  });
}

function membershipAuthorityContext(config, options = {}) {
  return {
    deploymentKey: options.authorityContext?.deploymentKey || options.deploymentKey || "unknown:unknown:0",
    origin: options.authorityContext?.origin || config.webBaseUrl || null,
  };
}

function membershipCacheFor(config, options = {}) {
  if (options.membershipCache) return options.membershipCache;
  if (!config.userDataDir) return null;
  if (!membershipCaches.has(config.userDataDir)) {
    membershipCaches.set(config.userDataDir, createMembershipCache(config));
  }
  return membershipCaches.get(config.userDataDir);
}

async function cachedMembership(config, sessionState, options = {}) {
  const cache = membershipCacheFor(config, options);
  const userId = options.userId || sessionState?.userId || options.sessionResult?.storedSession?.user?.id || null;
  const seasonId = options.weekCapability?.seasonId || options.seasonId || null;
  if (!cache || !userId || !seasonId) return null;
  await cache.initialize();
  const cached = cache.read(membershipAuthorityContext(config, options), userId, seasonId);
  if (!cached) return null;
  return baseState({
    canPlayCompetition: cached.status === "member",
    canSubmit: false,
    checkedAt: cached.checkedAt,
    effectiveSource: "durable-cache",
    joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
    message: PLAYER_MESSAGES[cached.status],
    revalidationRequired: true,
    seasonId,
    status: cached.status,
    technicalReason: "cached-conclusive-membership",
    weekId: config.defaultWeekId || config.pack?.weekId || null,
  });
}

async function preserveConclusiveMembership(config, sessionState, state, options = {}) {
  const cached = await cachedMembership(config, sessionState, options);
  return cached ? {
    ...cached,
    authDeferred: state.authDeferred === true,
    remoteFailure: state.remoteFailure,
    request: state.request,
    response: state.response,
    retryAfterMs: state.retryAfterMs,
    retryable: state.retryable,
    sessionRevision: state.sessionRevision,
    sessionStatus: state.sessionStatus,
    technicalReason: `${state.technicalReason || state.status};using-cache`,
  } : state;
}

async function rememberConclusiveMembership(config, sessionState, state, options = {}) {
  if (!["member", "not_member"].includes(state.status) || !state.seasonId) return state;
  const cache = membershipCacheFor(config, options);
  const userId = options.userId || sessionState?.userId || options.sessionResult?.storedSession?.user?.id || null;
  if (!cache || !userId) return state;
  await cache.initialize();
  await cache.remember(membershipAuthorityContext(config, options), {
    checkedAt: state.checkedAt,
    seasonId: state.seasonId,
    status: state.status,
    userId,
  });
  return { ...state, effectiveSource: "remote-conclusive", revalidationRequired: false };
}

async function checkSeasonMembership(config, sessionState, options = {}) {
  const weekId = config.defaultWeekId || config.pack?.weekId || null;
  const request = createRequestDetails(config, weekId);

  if (!sessionState?.hasSession && options.sessionResult === undefined) {
    if (sessionState?.requiresLogin === true) {
      return unauthenticatedSessionState(config, weekId, request, {
        sessionRevision: sessionState.sessionRevision,
        status: sessionState.status || "missing",
      }, options);
    }
    return baseState({
      checkedAt: options.checkedAt || new Date().toISOString(),
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: PLAYER_MESSAGES.no_session,
      request,
      status: "no_session",
      weekId,
    });
  }

  if (!weekId) {
    return baseState({
      checkedAt: options.checkedAt || new Date().toISOString(),
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: PLAYER_MESSAGES.missing_week,
      status: "missing_week",
    });
  }

  if (!config.webBaseUrl) {
    return preserveConclusiveMembership(config, sessionState, baseState({
      canPlayCompetition: false,
      canSubmit: false,
      checkedAt: options.checkedAt || new Date().toISOString(),
      message: PLAYER_MESSAGES.unknown,
      status: "unknown",
      technicalReason: "missing webBaseUrl",
      weekId,
    }), options);
  }

  if (options.deferRemote === true) {
    return preserveConclusiveMembership(config, sessionState, baseState({
      canPlayCompetition: false,
      canSubmit: false,
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl),
      message: PLAYER_MESSAGES.unknown,
      status: "unknown",
      technicalReason: "deferred",
      weekId,
    }), options);
  }

  try {
    const authenticated = await executeCanonicalAuthenticatedRequest({
      execute: ({ accessToken }) => executeRemoteRequest({
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        url: request.url,
        init: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
      remoteUsableOptions: { config, nowMs: options.nowMs },
      resolveSession: ({ force }) => resolveMembershipSessionResult(config, sessionState, {
        ...options,
        forceSessionRefresh: force,
        sessionResult: undefined,
      }),
      sessionResult: options.sessionResult,
    });

    if (authenticated.status === "requires-login") {
      return unauthenticatedSessionState(config, weekId, request, authenticated.sessionResult, options);
    }
    if (authenticated.status === "deferred") {
      return preserveConclusiveMembership(config, sessionState, deferredSessionState(
        config,
        weekId,
        authenticated.sessionResult,
        options,
        authenticated.reason || authenticated.error?.code,
      ), options);
    }
    if (authenticated.status === "credential-rejected") {
      return preserveConclusiveMembership(config, sessionState, baseState({
        checkedAt: options.checkedAt || new Date().toISOString(),
        joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
        message: PLAYER_MESSAGES.unknown,
        request,
        response: createResponseDetails(authenticated.requestResult.response, parseResponseText(authenticated.requestResult.bodyText)),
        retryable: true,
        sessionRevision: Number(authenticated.sessionResult?.sessionRevision) || 0,
        sessionStatus: authenticated.sessionResult?.status || null,
        status: "unknown",
        technicalReason: "credential-rejected-after-canonical-refresh",
        weekId,
      }), options);
    }

    const requestResult = authenticated.requestResult;
    if (!requestResult.ok) {
      return preserveConclusiveMembership(config, sessionState, baseState({
        canPlayCompetition: false,
        canSubmit: false,
        checkedAt: options.checkedAt || new Date().toISOString(),
        joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
        message: PLAYER_MESSAGES.unknown,
        remoteFailure: requestResult.failureType,
        request,
        retryable: requestResult.failureType !== "cancelled",
        status: "unknown",
        technicalReason: `${requestResult.failureType}:${requestResult.reason}`,
        weekId,
      }), options);
    }
    const response = requestResult.response;
    const body = parseResponseText(requestResult.bodyText);
    const responseDetails = createResponseDetails(response, body);
    const safeBody = body?.rawText ? { status: "error", message: "non_json_response" } : body;
    const retryable = RETRYABLE_HTTP_STATUSES.has(response.status) || response.status >= 500;
    const retryAfterMs = retryable
      ? parseRetryAfter(response.headers?.get?.("retry-after"), { nowMs: options.nowMs })
      : null;

    if (!response.ok && safeBody?.status) {
      const normalized = normalizeMembershipResponse(config, { ...safeBody, weekId }, {
        checkedAt: options.checkedAt,
        request,
        response: responseDetails,
        technicalReason: getTechnicalReason(responseDetails),
        weekId,
      });
      const result = { ...normalized, retryAfterMs, retryable };
      return ["member", "not_member"].includes(result.status)
        ? rememberConclusiveMembership(config, sessionState, result, options)
        : preserveConclusiveMembership(config, sessionState, result, options);
    }

    if (!response.ok) {
      return preserveConclusiveMembership(config, sessionState, baseState({
        canPlayCompetition: false,
        canSubmit: false,
        checkedAt: options.checkedAt || new Date().toISOString(),
        joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
        message: PLAYER_MESSAGES.error,
        request,
        response: responseDetails,
        retryAfterMs,
        retryable,
        status: "error",
        technicalReason: getTechnicalReason(responseDetails),
        weekId,
      }), options);
    }

    return rememberConclusiveMembership(config, sessionState, normalizeMembershipResponse(config, safeBody, {
      checkedAt: options.checkedAt,
      request,
      response: responseDetails,
      technicalReason: getTechnicalReason(responseDetails),
      weekId,
    }), options);
  } catch (error) {
    return preserveConclusiveMembership(config, sessionState, baseState({
      canPlayCompetition: false,
      canSubmit: false,
      checkedAt: options.checkedAt || new Date().toISOString(),
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: PLAYER_MESSAGES.unknown,
      request,
      remoteFailure: "transport-failure",
      retryable: true,
      status: "unknown",
      technicalReason: error?.name || "Error",
      weekId,
    }), options);
  }
}

function shouldBlockCompetition(membership) {
  return BLOCKING_STATUSES.has(membership?.status);
}

function shouldBlockSubmit(membership) {
  return membership?.canSubmit !== true;
}

module.exports = {
  checkSeasonMembership,
  cachedMembership,
  createResponseDetails,
  getMembershipUrl,
  normalizeMembershipResponse,
  safeMembershipJoinUrl,
  shouldBlockCompetition,
  shouldBlockSubmit,
};
