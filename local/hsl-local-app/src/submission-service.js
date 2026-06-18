const path = require("path");
const { assertAuthConfig, getValidStoredSession } = require("./auth");
const { assertDirExists, pathExists } = require("./file-utils");
const {
  RECENT_EVENT_THRESHOLD_MS,
  getEventFileFreshness,
  readEventFile,
  listJsonFiles,
} = require("./event-files");
const { movePendingToFailed, movePendingToSent } = require("./file-queue");
const { printHeader, printSubmitResult } = require("./output");
const {
  buildSubmissionPayload,
  responseLooksDuplicate,
  responseLooksOk,
} = require("./submission-payload");
const {
  assertSubmitConfig,
  getIngestUrl,
  getServerMessage,
  postSubmission,
} = require("./submission-http");

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

async function submitPendingFile(config, filename) {
  assertSubmitConfig(config);
  assertAuthConfig(config);

  await assertDirExists(config.eventsPendingDirAbs, "pending");
  await assertDirExists(config.eventsSentDirAbs, "sent");
  await assertDirExists(config.eventsFailedDirAbs, "failed");

  const safeName = path.basename(filename);
  const sourcePath = path.join(config.eventsPendingDirAbs, safeName);

  if (!(await pathExists(sourcePath))) {
    return {
      action: "missing",
      ok: false,
      filename: safeName,
      message: `No existe en pending: ${sourcePath}`,
    };
  }

  const freshness = await getEventFileFreshness(sourcePath, {
    thresholdMs: getRecentThresholdMs(config),
  });
  const recentWarning = formatRecentWarning(freshness);
  const result = await readEventFile(config.eventsPendingDirAbs, safeName);

  if (!result.ok) {
    if (freshness.isRecent) {
      return {
        action: "pending",
        ok: false,
        filename: safeName,
        message: `Evento local invalido, pero demasiado reciente para moverlo a failed. Se deja en pending para reintentar o revisar: ${result.errors.join("; ")}`,
        recentWarning,
      };
    }

    const reason = `Evento local inválido: ${result.errors.join("; ")}`;
    const finalPath = await movePendingToFailed(config, safeName, reason);

    return {
      action: "failed",
      ok: false,
      filename: safeName,
      message: reason,
      movedTo: finalPath,
      recentWarning,
    };
  }

  const submission = buildSubmitSummary(config, result.event);
  let storedSession;

  try {
    storedSession = await getValidStoredSession(config);
  } catch (error) {
    return {
      action: "auth_required",
      ok: false,
      filename: safeName,
      message: error.message,
      recentWarning,
      submission,
    };
  }

  const payload = buildSubmissionPayload(config, result.event, storedSession);

  let serverResult;

  try {
    serverResult = await postSubmission(
      config,
      storedSession.session.access_token,
      payload
    );
  } catch (error) {
    return {
      action: "network_error",
      ok: false,
      filename: safeName,
      message: `Error de red o servidor no accesible: ${error.message}`,
      recentWarning,
      submission,
    };
  }

  const { status, body } = serverResult;

  if (responseLooksOk(status, body) || responseLooksDuplicate(status, body)) {
    const finalPath = await movePendingToSent(config, safeName);

    return {
      action: responseLooksDuplicate(status, body) ? "duplicate_sent" : "sent",
      ok: true,
      filename: safeName,
      status,
      body,
      duplicateKey: payload.duplicateKey,
      movedTo: finalPath,
      recentWarning,
      submission,
    };
  }

  if (status === 401) {
    return {
      action: "auth_required",
      ok: false,
      filename: safeName,
      status,
      body,
      message: `401 no autorizado. Haz login de nuevo o revisa que el endpoint acepte Bearer token. Respuesta: ${getServerMessage(body)}`,
      recentWarning,
      submission,
    };
  }

  const shouldMoveToFailed = status === 400 || status === 403 || status === 409;

  if (shouldMoveToFailed) {
    const reason = `HTTP ${status}: ${getServerMessage(body)}`;
    const finalPath = await movePendingToFailed(config, safeName, reason);

    return {
      action: "failed",
      ok: false,
      filename: safeName,
      status,
      body,
      message: reason,
      movedTo: finalPath,
      recentWarning,
      submission,
    };
  }

  return {
    action: "pending",
    ok: false,
    filename: safeName,
    status,
    body,
    message: `HTTP ${status}: ${getServerMessage(body)}. Se deja en pending para revisar/reintentar.`,
    recentWarning,
    submission,
  };
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

async function submitAll(config) {
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

    const result = await submitPendingFile(config, filename);
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
}

module.exports = {
  buildSubmitSummary,
  formatRecentWarning,
  submitAll,
  submitOne,
  submitPendingFile,
};
