const { getValidStoredSession } = require("./auth");
const { normalizeWebBaseUrl, parseResponseBody } = require("./submission-http");

const NETWORK_STATUSES = new Set(["unknown", "error"]);
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
    canPlayCompetition: false,
    canSubmit: false,
    checkedAt: null,
    joinUrl: null,
    message: "No se pudo comprobar la participacion.",
    request: null,
    response: null,
    seasonId: null,
    status: "unknown",
    technicalReason: null,
    weekId: null,
    ...overrides,
  };
}

function absolutizeJoinUrl(config, joinUrl) {
  if (!joinUrl || typeof joinUrl !== "string") {
    return normalizeWebBaseUrl(config.webBaseUrl || "");
  }

  if (/^https?:\/\//i.test(joinUrl)) {
    return joinUrl;
  }

  const base = normalizeWebBaseUrl(config.webBaseUrl || "");
  const path = joinUrl.startsWith("/") ? joinUrl : `/${joinUrl}`;
  return `${base}${path}`;
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

  const bodyStatus = typeof body.status === "string" ? body.status : null;
  const bodyMessage = typeof body.message === "string"
    ? body.message
    : typeof body.error === "string"
      ? body.error
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
  const joinUrl = absolutizeJoinUrl(config, body?.joinUrl);
  const serverMessage = typeof body?.message === "string" ? body.message : null;
  const request = options.request || createRequestDetails(config, weekId);
  const response = options.response || null;
  const technicalReason = options.technicalReason || getTechnicalReason(response);

  if (status === "member") {
    return baseState({
      canPlayCompetition: true,
      canSubmit: true,
      checkedAt,
      joinUrl,
      message: serverMessage || PLAYER_MESSAGES.member,
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
      message: serverMessage || PLAYER_MESSAGES.not_member,
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
      message: serverMessage || PLAYER_MESSAGES.invalid_week,
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
      message: serverMessage || PLAYER_MESSAGES.error,
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
    message: serverMessage || PLAYER_MESSAGES.unknown,
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

  if (!sessionState?.hasSession) {
    if (sessionState?.status === "expired" || sessionState?.status === "error") {
      return baseState({
        checkedAt: options.checkedAt || new Date().toISOString(),
        joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
        message: PLAYER_MESSAGES.unauthenticated,
        request,
        status: "unauthenticated",
        technicalReason: sessionState.message || sessionState.error || "invalid_local_session",
        weekId,
      });
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

  let storedSession;

  try {
    storedSession = options.storedSession || await getValidStoredSession(config);
  } catch (error) {
    return baseState({
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      checkedAt: options.checkedAt || new Date().toISOString(),
      message: PLAYER_MESSAGES.unauthenticated,
      request,
      status: "unauthenticated",
      technicalReason: error.message,
      weekId,
    });
  }

  const accessToken = storedSession?.session?.access_token;

  if (!accessToken) {
    return baseState({
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      checkedAt: options.checkedAt || new Date().toISOString(),
      message: PLAYER_MESSAGES.unauthenticated,
      request,
      status: "unauthenticated",
      technicalReason: "missing_access_token",
      weekId,
    });
  }

  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(request.url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = await parseResponseBody(response);
    const responseDetails = createResponseDetails(response, body);
    const safeBody = body?.rawText ? { status: "error", message: "non_json_response" } : body;

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
      return normalizeMembershipResponse(config, { ...safeBody, weekId }, {
        checkedAt: options.checkedAt,
        request,
        response: responseDetails,
        technicalReason: getTechnicalReason(responseDetails),
        weekId,
      });
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
      status: "unknown",
      technicalReason: error.message,
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
  shouldBlockCompetition,
  shouldBlockSubmit,
};
