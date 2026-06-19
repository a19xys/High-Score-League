const { getValidStoredSession } = require("./auth");
const { normalizeWebBaseUrl, parseResponseBody } = require("./submission-http");

const NETWORK_STATUSES = new Set(["unknown", "error"]);
const BLOCKING_STATUSES = new Set(["no_session", "missing_week", "invalid_week", "not_member", "unauthenticated"]);

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

function normalizeMembershipResponse(config, body, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString();
  const status = typeof body?.status === "string" ? body.status : "unknown";
  const weekId = typeof body?.weekId === "string" ? body.weekId : options.weekId || null;
  const seasonId = typeof body?.seasonId === "string" ? body.seasonId : null;
  const joinUrl = absolutizeJoinUrl(config, body?.joinUrl);
  const serverMessage = typeof body?.message === "string" ? body.message : null;

  if (status === "member") {
    return baseState({
      canPlayCompetition: true,
      canSubmit: true,
      checkedAt,
      joinUrl,
      message: serverMessage || "Participas en esta temporada. Puedes jugar competicion.",
      seasonId,
      status,
      weekId,
    });
  }

  if (status === "not_member") {
    return baseState({
      checkedAt,
      joinUrl,
      message: serverMessage || "No participas en esta temporada. Unete desde la web para competir.",
      seasonId,
      status,
      weekId,
    });
  }

  if (status === "invalid_week") {
    return baseState({
      checkedAt,
      joinUrl,
      message: serverMessage || "No se encontro la semana del pack.",
      seasonId,
      status,
      weekId,
    });
  }

  if (status === "unauthenticated") {
    return baseState({
      checkedAt,
      joinUrl,
      message: "La sesion no es valida. Inicia sesion de nuevo.",
      seasonId,
      status,
      weekId,
    });
  }

  return baseState({
    canPlayCompetition: true,
    canSubmit: false,
    checkedAt,
    joinUrl,
    message: serverMessage || "No se pudo comprobar la participacion. Puedes practicar; si juegas competicion, la puntuacion quedara local hasta poder verificarse.",
    seasonId,
    status: NETWORK_STATUSES.has(status) ? status : "unknown",
    technicalReason: body ? JSON.stringify(body) : null,
    weekId,
  });
}

async function checkSeasonMembership(config, sessionState, options = {}) {
  const weekId = config.defaultWeekId || config.pack?.weekId || null;

  if (!sessionState?.hasSession) {
    return baseState({
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: "Inicia sesion para competir.",
      status: "no_session",
      weekId,
    });
  }

  if (!weekId) {
    return baseState({
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: "El pack no tiene weekId. No se puede comprobar la temporada.",
      status: "missing_week",
    });
  }

  if (!config.webBaseUrl) {
    return baseState({
      canPlayCompetition: true,
      canSubmit: false,
      message: "No hay webBaseUrl configurado para comprobar la participacion.",
      status: "unknown",
      technicalReason: "missing webBaseUrl",
      weekId,
    });
  }

  let storedSession;

  try {
    storedSession = options.storedSession || await getValidStoredSession(config);
  } catch (error) {
    return baseState({
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: "La sesion no es valida. Inicia sesion de nuevo.",
      status: "unauthenticated",
      technicalReason: error.message,
      weekId,
    });
  }

  const accessToken = storedSession?.session?.access_token;

  if (!accessToken) {
    return baseState({
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: "La sesion local no tiene access token valido.",
      status: "unauthenticated",
      weekId,
    });
  }

  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(getMembershipUrl(config, weekId), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = await parseResponseBody(response);

    if (response.status === 401) {
      return normalizeMembershipResponse(config, { ...body, status: "unauthenticated", weekId }, {
        checkedAt: options.checkedAt,
        weekId,
      });
    }

    if (!response.ok && body?.status) {
      return normalizeMembershipResponse(config, { ...body, weekId }, {
        checkedAt: options.checkedAt,
        weekId,
      });
    }

    if (!response.ok) {
      return baseState({
        canPlayCompetition: true,
        canSubmit: false,
        checkedAt: options.checkedAt || new Date().toISOString(),
        joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
        message: "No se pudo comprobar la participacion. Puedes practicar; si juegas competicion, la puntuacion quedara local hasta poder verificarse.",
        status: "error",
        technicalReason: `HTTP ${response.status}`,
        weekId,
      });
    }

    return normalizeMembershipResponse(config, body, {
      checkedAt: options.checkedAt,
      weekId,
    });
  } catch (error) {
    return baseState({
      canPlayCompetition: true,
      canSubmit: false,
      checkedAt: options.checkedAt || new Date().toISOString(),
      joinUrl: normalizeWebBaseUrl(config.webBaseUrl || ""),
      message: "No se pudo comprobar la participacion. Puedes practicar; si juegas competicion, la puntuacion quedara local hasta poder verificarse.",
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
  getMembershipUrl,
  normalizeMembershipResponse,
  shouldBlockCompetition,
  shouldBlockSubmit,
};
