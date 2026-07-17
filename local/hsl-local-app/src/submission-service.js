const path = require("path");
const { assertAuthConfig, resolveCanonicalSessionResult } = require("./auth");
const { assertDirExists, pathExists } = require("./file-utils");
const {
  RECENT_EVENT_THRESHOLD_MS,
  getEventFileFreshness,
  readEventFile,
  listJsonFiles,
} = require("./event-files");
const { movePendingToFailed, movePendingToSent } = require("./file-queue");
const { printHeader, printSubmitResult } = require("./output");
const { buildSubmissionPayload } = require("./submission-payload");
const {
  assertSubmitConfig,
  getIngestUrl,
  postSubmission,
} = require("./submission-http");
const {
  baseOutcome,
  classifySubmissionHttpResult,
  classifySubmissionRequestFailure,
} = require("./submission-outcome");
const {
  assertSessionResult,
  isSessionDeferred,
  isSessionRemoteUsableNow,
  requiresSessionLogin,
} = require("./session-result");

function withOutcome(result, outcome) {
  return { ...result, ...outcome };
}

function buildSubmitSummary(config, event) {
  return {
    endpoint: getIngestUrl(config),
    game: event.game || null,
    rom: event.rom || null,
    score: event.score,
    weekId: config.defaultWeekId || null,
  };
}

function getRecentThresholdMs(config) {
  return Number.isFinite(config.recentEventThresholdMs)
    ? config.recentEventThresholdMs
    : RECENT_EVENT_THRESHOLD_MS;
}

function formatRecentWarning(freshness) {
  if (!freshness?.isRecent) {
    return null;
  }

  return `Archivo modificado hace ${Math.round(freshness.ageMs)}ms; puede estar aun escribiendose. Umbral: ${freshness.thresholdMs}ms.`;
}

async function getSubmissionSessionResult(config, options = {}) {
  if (options.sessionResult !== undefined) return assertSessionResult(await options.sessionResult);
  const resolver = options.getSessionResultImpl || resolveCanonicalSessionResult;
  let result;
  try {
    result = await resolver(config, options);
  } catch (error) {
    if (error?.sessionResult) return assertSessionResult(error.sessionResult);
    return { resolutionError: error };
  }
  return assertSessionResult(result);
}

function buildSessionUnavailableResult(sessionResult, details) {
  const requiresLogin = sessionResult && requiresSessionLogin(sessionResult);
  if (requiresLogin) {
    const playerMessage = "La puntuacion sigue guardada. Inicia sesion de nuevo para enviarla.";
    return withOutcome({
      ...details,
      action: "auth_required",
      message: playerMessage,
      sessionStatus: sessionResult.status,
    }, baseOutcome({
      authRequired: true,
      outcome: "auth-required",
      playerMessage,
      technicalReason: `session-${sessionResult.status}`,
      terminal: false,
    }));
  }

  const status = sessionResult?.status || "resolution-error";
  const playerMessage = "La credencial remota no esta disponible temporalmente. La puntuacion sigue guardada.";
  return withOutcome({
    ...details,
    action: "pending",
    message: playerMessage,
    sessionDeferred: true,
    sessionStatus: status,
  }, baseOutcome({
    authRequired: false,
    outcome: "auth-deferred",
    playerMessage,
    preservePending: true,
    retryable: sessionResult ? isSessionDeferred(sessionResult) : true,
    technicalReason: `session-${status}`,
    terminal: false,
  }));
}

async function submitPendingFile(config, filename, options = {}) {
  assertSubmitConfig(config);
  assertAuthConfig(config);

  await assertDirExists(config.eventsPendingDirAbs, "pending");
  await assertDirExists(config.eventsSentDirAbs, "sent");
  await assertDirExists(config.eventsFailedDirAbs, "failed");

  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);

  if (!(await pathExists(sourcePath))) {
    return withOutcome({
      action: "missing",
      filename: safeName,
      message: `No existe en pending: ${sourcePath}`,
    }, baseOutcome({ outcome: "missing", preservePending: false, technicalReason: "missing-local-file", terminal: true }));
  }

  const freshness = await getEventFileFreshness(sourcePath, {
    thresholdMs: getRecentThresholdMs(config),
  });
  const recentWarning = formatRecentWarning(freshness);
  const result = await readEventFile(config.eventsPendingDirAbs, safeName);

  if (!result.ok) {
    if (freshness.isRecent) {
      return withOutcome({
        action: "pending",
        filename: safeName,
        message: `Evento local invalido, pero demasiado reciente para moverlo a failed. Se deja en pending para reintentar o revisar: ${result.errors.join("; ")}`,
        recentWarning,
      }, baseOutcome({ outcome: "local-recent", retryable: true, technicalReason: "recent-local-event" }));
    }

    const reason = `Evento local inválido: ${result.errors.join("; ")}`;
    const finalPath = await movePendingToFailed(config, safeName, reason);

    return withOutcome({
      action: "failed",
      filename: safeName,
      message: reason,
      movedTo: finalPath,
      recentWarning,
    }, baseOutcome({ outcome: "local-invalid", playerMessage: "El evento local no es valido y requiere atencion.", preservePending: false, technicalReason: "invalid-local-event", terminal: true }));
  }

  const submission = buildSubmitSummary(config, result.event);
  const sessionResult = await getSubmissionSessionResult(config, options);
  if (sessionResult.resolutionError || !isSessionRemoteUsableNow(sessionResult, { config, nowMs: options.nowMs })) {
    return buildSessionUnavailableResult(sessionResult.resolutionError ? null : sessionResult, {
      filename: safeName,
      recentWarning,
      submission,
    });
  }
  const storedSession = sessionResult.storedSession;
  const hasRemoteCredential = typeof storedSession?.session?.access_token === "string"
    && storedSession.session.access_token.length > 0
    && typeof storedSession?.user?.id === "string"
    && storedSession.user.id.length > 0;
  if (!hasRemoteCredential) {
    return buildSessionUnavailableResult(null, {
      filename: safeName,
      recentWarning,
      submission,
    });
  }

  const payload = buildSubmissionPayload(config, result.event, storedSession);

  let serverResult;

  try {
    serverResult = await postSubmission(
      config,
      storedSession.session.access_token,
      payload,
      options,
    );
  } catch (error) {
    serverResult = {
      failureType: "transport-failure",
      ok: false,
      technicalReason: error?.name || "Error",
    };
  }

  if (!serverResult.ok) {
    const outcome = classifySubmissionRequestFailure(serverResult);
    return withOutcome({
      action: "network_error",
      filename: safeName,
      message: outcome.playerMessage,
      recentWarning,
      submission,
    }, outcome);
  }

  const { status, body, retryAfterHeader } = serverResult;
  const outcome = classifySubmissionHttpResult({ body, nowMs: options.nowMs, retryAfterHeader, status });

  if (["success", "duplicate"].includes(outcome.outcome)) {
    const finalPath = await movePendingToSent(config, safeName);

    return withOutcome({
      action: outcome.outcome === "duplicate" ? "duplicate_sent" : "sent",
      filename: safeName,
      status,
      duplicateKey: payload.duplicateKey,
      movedTo: finalPath,
      recentWarning,
      submission,
    }, outcome);
  }

  if (outcome.authRequired) {
    return withOutcome({
      action: "auth_required",
      filename: safeName,
      status,
      message: outcome.playerMessage,
      recentWarning,
      submission,
    }, outcome);
  }

  if (outcome.outcome === "terminal-failure") {
    const reason = `HTTP ${status}: envio rechazado por el servicio.`;
    const finalPath = await movePendingToFailed(config, safeName, reason);

    return withOutcome({
      action: "failed",
      filename: safeName,
      status,
      message: reason,
      movedTo: finalPath,
      recentWarning,
      submission,
    }, outcome);
  }

  return withOutcome({
    action: "pending",
    filename: safeName,
    status,
    message: outcome.playerMessage,
    recentWarning,
    submission,
  }, outcome);
}

async function submitOne(config, filename) {
  printHeader(config);

  if (!filename) {
    console.error("Uso: node app.js submit <archivo.json>");
    process.exitCode = 1;
    return;
  }

  const result = await submitPendingFile(config, filename);
  printSubmitResult(result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function submitAll(config, options = {}) {
  printHeader(config);

  await assertDirExists(config.eventsPendingDirAbs, "pending");

  const files = await listJsonFiles(config.eventsPendingDirAbs);

  if (files.length === 0) {
    console.log("No hay eventos pendientes para enviar.");
    console.log("");
    return;
  }

  console.log(`Eventos pendientes: ${files.length}`);
  console.log(`Endpoint: ${getIngestUrl(config)}`);
  console.log(`Week: ${config.defaultWeekId}`);
  console.log("");

  let sent = 0;
  let failed = 0;
  let pending = 0;
  let skippedRecent = 0;

  for (const filename of files) {
    if (options.shouldContinue && !options.shouldContinue()) {
      pending += 1;
      console.log("Envio detenido por cambio de contexto.");
      break;
    }
    const sourcePath = path.join(config.eventsPendingDirAbs, filename);
    const freshness = await getEventFileFreshness(sourcePath, {
      thresholdMs: getRecentThresholdMs(config),
    });

    if (freshness.isRecent) {
      pending += 1;
      skippedRecent += 1;
      console.log(`[SKIP] ${filename}`);
      console.log(formatRecentWarning(freshness));
      console.log("Se deja en pending para evitar leer un JSON mientras MAME lo escribe.");
      console.log("");
      continue;
    }

    const result = await submitPendingFile(config, filename, options);
    options.onResult?.(result);
    printSubmitResult(result);

    if (result.ok) {
      sent += 1;
    } else if (result.action === "network_error" || result.action === "auth_required" || result.action === "pending") {
      pending += 1;
    } else {
      failed += 1;
    }

    if (result.action === "auth_required") {
      console.log("Se detiene submit-all porque falta autenticación válida.");
      break;
    }
    if (result.sessionDeferred) {
      console.log("Se detiene submit-all hasta que la credencial remota vuelva a estar disponible.");
      break;
    }
    if (options.stopOnTransportFailure && result.action === "network_error") {
      console.log("Se detiene submit-all por perdida de conectividad.");
      break;
    }
    if (options.stopOnRetryableFailure && result.retryable) {
      console.log("Se detiene submit-all hasta el siguiente intento permitido.");
      break;
    }
  }

  console.log("Resumen submit-all");
  console.log("==================");
  console.log(`Enviados/sent: ${sent}`);
  console.log(`Fallidos/failed: ${failed}`);
  console.log(`Siguen pending: ${pending}`);
  console.log(`Omitidos por recientes: ${skippedRecent}`);
  console.log("");

  if (failed > 0 || pending > 0) {
    process.exitCode = 1;
  }

  return { failed, pending, sent, skippedRecent };
}

module.exports = {
  buildSubmitSummary,
  formatRecentWarning,
  submitAll,
  submitOne,
  submitPendingFile,
};
