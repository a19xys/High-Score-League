const {
  responseLooksDuplicate,
  responseLooksOk,
} = require("./submission-payload");

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
const AMBIGUOUS_HTTP_STATUSES = new Set([403, 404, 409]);
const REJECTED_DOMAIN_CODES = new Set([
  "DETECTED_AT_IN_FUTURE",
  "NOT_SEASON_MEMBER",
  "WEEK_CLOSED_AT_DETECTION",
  "WEEK_GAME_NOT_ASSIGNED",
  "WEEK_NOT_FOUND",
  "WEEK_NOT_OPEN_AT_DETECTION",
  "WEEK_WINDOW_UNAVAILABLE",
]);
const COMPETITION_REJECTED_CODES = new Set([
  "COMPETITION_ARTIFACT_MISMATCH",
  "COMPETITION_DUPLICATE_KEY_MISMATCH",
  "COMPETITION_EVENT_BINDING_MISMATCH",
  "COMPETITION_EVIDENCE_INVALID",
  "COMPETITION_INTEGRITY_REQUIRED",
  "COMPETITION_MANIFEST_MISMATCH",
  "COMPETITION_PACK_MISMATCH",
  "COMPETITION_PLAYER_MISMATCH",
  "COMPETITION_POLICY_MISMATCH",
  "COMPETITION_PROVENANCE_INVALID",
]);
const FAILED_TECHNICAL_CODES = new Set([
  "DUPLICATE_KEY_CONFLICT",
  "SUBMISSION_POLICY_REJECTED",
]);
const MIN_RETRY_AFTER_MS = 5000;
const MAX_RETRY_AFTER_MS = 15 * 60 * 1000;

function parseRetryAfter(value, options = {}) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const trimmed = value.trim();
  let delayMs;

  if (/^\d+$/.test(trimmed)) {
    delayMs = Number(trimmed) * 1000;
  } else {
    const timestamp = Date.parse(trimmed);
    if (!Number.isFinite(timestamp)) return null;
    delayMs = timestamp - nowMs;
  }

  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_RETRY_AFTER_MS) return null;
  return Math.max(MIN_RETRY_AFTER_MS, Math.min(MAX_RETRY_AFTER_MS, Math.round(delayMs)));
}

function baseOutcome(overrides = {}) {
  return {
    authRequired: false,
    httpStatus: null,
    ok: false,
    outcome: "attention-required",
    playerMessage: "La puntuacion sigue guardada localmente y requiere atencion.",
    preservePending: true,
    retryAfterMs: null,
    retryable: false,
    technicalReason: "unexpected-result",
    terminal: false,
    ...overrides,
  };
}

function classifySubmissionHttpResult(input = {}) {
  const status = Number(input.status) || 0;
  const body = input.body || null;
  const domainCode = typeof body?.code === "string" ? body.code.trim().toUpperCase() : null;
  const duplicate = responseLooksDuplicate(status, body);

  if (responseLooksOk(status, body) || duplicate) {
    return baseOutcome({
      httpStatus: status,
      ok: true,
      outcome: duplicate ? "duplicate" : "success",
      playerMessage: duplicate ? "La puntuacion ya estaba recibida y queda confirmada." : "Puntuacion enviada.",
      preservePending: false,
      technicalReason: duplicate ? "duplicate-accepted" : "accepted",
      terminal: true,
    });
  }

  if (status === 401) {
    return baseOutcome({
      authRequired: true,
      httpStatus: status,
      outcome: "auth-required",
      playerMessage: "La puntuacion sigue guardada. Inicia sesion de nuevo para enviarla.",
      technicalReason: "http-401",
    });
  }

  if (domainCode && REJECTED_DOMAIN_CODES.has(domainCode)) {
    return baseOutcome({
      domainCode,
      httpStatus: status,
      outcome: "rejected-domain",
      playerMessage: "La puntuacion no pertenece a una ventana competitiva valida y se conserva como rechazada.",
      preservePending: false,
      technicalReason: `domain-${domainCode.toLowerCase()}`,
      terminal: true,
    });
  }

  if (status === 409 && domainCode && COMPETITION_REJECTED_CODES.has(domainCode)) {
    return baseOutcome({
      domainCode,
      httpStatus: status,
      outcome: "rejected-domain",
      playerMessage: "Esta captura no coincide con la politica competitiva de la semana y se conserva como rechazada.",
      preservePending: false,
      technicalReason: `competition-${domainCode.toLowerCase()}`,
      terminal: true,
    });
  }

  if (domainCode && FAILED_TECHNICAL_CODES.has(domainCode)) {
    return baseOutcome({
      domainCode,
      httpStatus: status,
      outcome: "attention-required",
      playerMessage: "La puntuacion sigue guardada localmente y requiere atencion tecnica.",
      preservePending: false,
      technicalReason: `technical-${domainCode.toLowerCase()}`,
      terminal: true,
    });
  }

  if (RETRYABLE_HTTP_STATUSES.has(status) || status >= 500) {
    return baseOutcome({
      httpStatus: status,
      outcome: "retryable-http",
      playerMessage: "El servicio no esta disponible temporalmente. La puntuacion sigue guardada.",
      retryAfterMs: parseRetryAfter(input.retryAfterHeader, { nowMs: input.nowMs }),
      retryable: true,
      technicalReason: `http-${status || "unknown"}`,
    });
  }

  if (AMBIGUOUS_HTTP_STATUSES.has(status)) {
    return baseOutcome({
      httpStatus: status,
      outcome: "ambiguous-http",
      playerMessage: "El servicio no confirmo el resultado. La puntuacion sigue guardada para un reintento seguro.",
      retryable: true,
      technicalReason: `ambiguous-http-${status}`,
    });
  }

  return baseOutcome({
    httpStatus: status || null,
    outcome: "attention-required",
    playerMessage: "La respuesta del servicio no era compatible y la puntuacion requiere atencion tecnica.",
    preservePending: false,
    technicalReason: `unexpected-http-${status || "unknown"}`,
    terminal: true,
  });
}

function classifySubmissionRequestFailure(failure = {}) {
  const type = failure.failureType || "transport-failure";
  if (type === "cancelled") {
    return baseOutcome({
      outcome: "cancelled",
      playerMessage: "Envio cancelado. La puntuacion sigue guardada.",
      technicalReason: `cancelled:${failure.reason || "external-abort"}`,
    });
  }
  if (type === "timeout") {
    return baseOutcome({
      outcome: "timeout",
      playerMessage: "El servicio tardo demasiado. La puntuacion sigue guardada.",
      retryable: true,
      technicalReason: "request-timeout",
    });
  }
  return baseOutcome({
    outcome: "transport-failure",
    playerMessage: "No se pudo contactar con el servicio. La puntuacion sigue guardada.",
    retryable: true,
    technicalReason: failure.technicalReason || "transport-failure",
  });
}

module.exports = {
  AMBIGUOUS_HTTP_STATUSES,
  COMPETITION_REJECTED_CODES,
  FAILED_TECHNICAL_CODES,
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  REJECTED_DOMAIN_CODES,
  RETRYABLE_HTTP_STATUSES,
  baseOutcome,
  classifySubmissionHttpResult,
  classifySubmissionRequestFailure,
  parseRetryAfter,
};
