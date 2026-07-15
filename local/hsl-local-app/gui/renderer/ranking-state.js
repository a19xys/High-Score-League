const RANKING_COPY = Object.freeze({
  connecting: "Comprobando conexion con High Score League.",
  notConfigured: "Este pack no tiene un ranking configurado.",
  offline: "Necesitas conexion para abrir el ranking.",
  checking: "Comprobando la disponibilidad del ranking.",
  unavailable: "El ranking todavia no esta disponible.",
  unknown: "No se pudo comprobar el ranking.",
});

export function getRankingActionState(state, game) {
  const weekId = game?.weekId || null;

  if (!weekId) {
    return { available: false, status: "unavailable", reason: RANKING_COPY.notConfigured, url: null };
  }

  const connectionStatus = state.connectivity?.status || state.connectionStatus || "connecting";

  if (connectionStatus === "offline") {
    return { available: false, status: "unknown", reason: RANKING_COPY.offline, url: null };
  }

  if (connectionStatus !== "connected") {
    return { available: false, status: "checking", reason: RANKING_COPY.connecting, url: null };
  }

  if (state.rankingOpening) {
    return { available: false, status: "checking", reason: RANKING_COPY.checking, url: null };
  }

  const capability = state.rankingCapabilities?.entries?.[weekId];
  const status = capability?.status || "checking";

  if (status === "available" && capability?.url) {
    return { available: true, status, reason: null, url: capability.url };
  }

  const reason = status === "unavailable"
    ? RANKING_COPY.unavailable
    : status === "unknown"
      ? RANKING_COPY.unknown
      : RANKING_COPY.checking;

  return { available: false, status, reason, url: null };
}

export { RANKING_COPY };
