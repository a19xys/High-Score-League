const { resolveCanonicalSessionResult } = require("./auth");
const { normalizeWebBaseUrl, parseResponseText } = require("./submission-http");
const { executeRemoteRequest } = require("./remote-request");
const { parseRetryAfter, RETRYABLE_HTTP_STATUSES } = require("./submission-outcome");
const {
  createSessionResult,
  isCanonicalSessionResult,
  isSessionRemoteUsableNow,
  requiresSessionLogin,
} = require("./session-result");

const NETWORK_STATUSES = new Set(["unknown", "error"]);
const SAFE_BODY_STATUSES = new Set(["member", "not_member", "unauthenticated", "invalid_week", "error", "unknown"]);
const BLOCKING_STATUSES = new Set(["no_session", "missing_week", "invalid_week", "not_member", "unauthenticated"]);
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
    canPlayCompetition: true,
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
      message: PLAYER_MESSAGES.unauthenticated,
      request,
      response,
      seasonId,
      status,
      technicalReason,
      weekId,
    });
  }

  if (status === "error") {
    return baseState({
      canPlayCompetition: true,
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
    canPlayCompetition: true,
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
    return baseState({
      canPlayCompetition: true,
      canSubmit: false,
      checkedAt: options.checkedAt || new Date().toISOString(),
      message: PLAYER_MESSAGES.unknown,
      status: "unknown",
      technicalReason: "missing webBaseUrl",
      weekId,
    });
  }

  if (options.deferRemote === true) {
    return baseState({
      canPlayCompetition: true,
      canSubmit: false,
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl),
      message: PLAYER_MESSAGES.unknown,
      status: "unknown",
      technicalReason: "deferred",
      weekId,
    });
  }

  let sessionResult;

  try {
    sessionResult = await resolveMembershipSessionResult(config, sessionState, options);
  } catch (error) {
    if (requiresSessionLogin(error?.sessionResult)) {
      return unauthenticatedSessionState(config, weekId, request, error.sessionResult, options);
    }
    return deferredSessionState(config, weekId, error?.sessionResult, options, error?.code || "session-resolution-failed");
  }

  if (!isCanonicalSessionResult(sessionResult)) {
    return deferredSessionState(config, weekId, null, options, "invalid-session-result");
  }

  if (requiresSessionLogin(sessionResult)) {
    return unauthenticatedSessionState(config, weekId, request, sessionResult, options);
  }

  if (!isSessionRemoteUsableNow(sessionResult, { config, nowMs: options.nowMs })) {
    return deferredSessionState(config, weekId, sessionResult, options);
  }

  const accessToken = sessionResult.storedSession?.session?.access_token;

  if (!accessToken) {
    return deferredSessionState(config, weekId, sessionResult, options, "remote-credential-missing");
  }

  try {
    const requestResult = await executeRemoteRequest({
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      url: request.url,
      init: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      },
    });
    if (!requestResult.ok) {
      return baseState({
        canPlayCompetition: true,
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
      });
    }
    const response = requestResult.response;
    const body = parseResponseText(requestResult.bodyText);
    const responseDetails = createResponseDetails(response, body);
    const safeBody = body?.rawText ? { status: "error", message: "non_json_response" } : body;
    const retryable = RETRYABLE_HTTP_STATUSES.has(response.status) || response.status >= 500;
    const retryAfterMs = retryable
      ? parseRetryAfter(response.headers?.get?.("retry-after"), { nowMs: options.nowMs })
      : null;

    if (response.status === 401) {
      return normalizeMembershipResponse(config, { ...safeBody, status: "unauthenticated", weekId }, {
        checkedAt: options.checkedAt,
        request,
        response: responseDetails,
        technicalReason: getTechnicalReason(responseDetails),
        weekId,
      });
    }

    if (!response.ok && safeBody?.status) {
      const normalized = normalizeMembershipResponse(config, { ...safeBody, weekId }, {
        checkedAt: options.checkedAt,
        request,
        response: responseDetails,
        technicalReason: getTechnicalReason(responseDetails),
        weekId,
      });
      return { ...normalized, retryAfterMs, retryable };
    }

    if (!response.ok) {
      return baseState({
        canPlayCompetition: true,
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
      });
    }

    return normalizeMembershipResponse(config, safeBody, {
      checkedAt: options.checkedAt,
      request,
      response: responseDetails,
      technicalReason: getTechnicalReason(responseDetails),
      weekId,
    });
  } catch (error) {
    return baseState({
      canPlayCompetition: true,
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
    });
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
  createResponseDetails,
  getMembershipUrl,
  normalizeMembershipResponse,
  safeMembershipJoinUrl,
  shouldBlockCompetition,
  shouldBlockSubmit,
};
