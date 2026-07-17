const {
  responseLooksDuplicate,
  responseLooksOk,
} = require("./submission-payload");

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
const TERMINAL_HTTP_STATUSES = new Set([400, 403, 409]);
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

  if (TERMINAL_HTTP_STATUSES.has(status)) {
    return baseOutcome({
      httpStatus: status,
      outcome: "terminal-failure",
      playerMessage: "La puntuacion fue rechazada y se ha movido a Requiere atencion.",
      preservePending: false,
      technicalReason: `http-${status}`,
      terminal: true,
    });
  }

  return baseOutcome({
    httpStatus: status || null,
    outcome: "attention-required",
    playerMessage: "La respuesta del servicio no era la esperada. La puntuacion sigue guardada y requiere atencion.",
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
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  RETRYABLE_HTTP_STATUSES,
  TERMINAL_HTTP_STATUSES,
  baseOutcome,
  classifySubmissionHttpResult,
  classifySubmissionRequestFailure,
  parseRetryAfter,
};
