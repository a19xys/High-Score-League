import { deriveRemoteAvailability } from "./remote-availability.js";

const RANKING_COPY = Object.freeze({
  connecting: "Comprobando conexion con High Score League.",
  notConfigured: "Este pack no tiene un ranking configurado.",
  offline: "Necesitas conexion para abrir el ranking.",
  checking: "Comprobando la disponibilidad del ranking.",
  unavailable: "El ranking todavia no esta disponible.",
  unknown: "No se pudo comprobar el ranking.",
});

function safeCapabilityUrl(value, webBaseUrl) {
  try {
    const candidate = new URL(String(value || ""));
    const allowed = new URL(String(webBaseUrl || ""));
    return ["http:", "https:"].includes(candidate.protocol) && candidate.origin === allowed.origin;
  } catch {
    return false;
  }
}

export function getRankingActionState(state, game) {
  const weekId = game?.weekId || null;
  if (!weekId) return { available: false, status: "unavailable", reason: RANKING_COPY.notConfigured, url: null };

  const remote = deriveRemoteAvailability(state.connectivity);
  if (remote.status === "offline") return { available: false, status: "unknown", reason: RANKING_COPY.offline, url: null };
  if (!remote.available) return { available: false, status: "checking", reason: RANKING_COPY.connecting, url: null };
  if (state.rankingOpening) return { available: false, status: "checking", reason: RANKING_COPY.checking, url: null };

  const capability = state.rankingCapabilities?.entries?.[weekId];
  const identityMatches = capability?.weekId === weekId;
  const safeUrl = safeCapabilityUrl(capability?.url, state.rankingCapabilities?.webBaseUrl);
  const status = capability?.status || "checking";

  if (status === "available" && identityMatches && safeUrl) {
    return { available: true, status, reason: null, url: capability.url };
  }
  const reason = status === "unavailable" && identityMatches
    ? RANKING_COPY.unavailable
    : status === "unknown"
      ? RANKING_COPY.unknown
      : RANKING_COPY.checking;
  return { available: false, status: identityMatches ? status : "checking", reason, url: null };
}

export { RANKING_COPY, safeCapabilityUrl };
