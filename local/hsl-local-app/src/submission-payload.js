const crypto = require("crypto");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildDuplicateKey(config, event, storedSession) {
  const userId = storedSession?.user?.id || "unknown-user";

  const stableParts = [
    "hsl",
    "v1",
    config.defaultWeekId,
    userId,
    event.rom,
    String(event.score),
    event.detectedAt,
    event.source,
    event.mameVersion || "",
    event.pluginVersion || "",
  ];

  return `hsl:v1:${sha256Hex(stableParts.join("|"))}`;
}

function buildSubmissionPayload(config, event, storedSession) {
  return {
    weekId: config.defaultWeekId,
    score: event.score,
    detectedAt: event.detectedAt,
    source: event.source,
    rom: event.rom,
    mameVersion: event.mameVersion || undefined,
    clientVersion: config.clientVersion || "0.1.0",
    comment: config.defaultComment || "Subida desde app local",
    rawEvent: {
      schemaVersion: event.schemaVersion,
      game: event.game,
      pluginVersion: event.pluginVersion,
      detection: event.detection || null,
      scoreData: event.scoreData || null,
      localEvent: event,
    },
    duplicateKey: buildDuplicateKey(config, event, storedSession),
  };
}

function responseLooksDuplicate(status, body) {
  if (!body || typeof body !== "object") {
    return false;
  }

  if (body.duplicate === true) {
    return true;
  }

  const text = JSON.stringify(body).toLowerCase();

  return status === 409 && text.includes("duplic");
}

function responseLooksOk(status, body) {
  if (status >= 200 && status < 300) {
    if (!body || typeof body !== "object") {
      return true;
    }

    if (body.ok === false && body.duplicate !== true) {
      return false;
    }

    return true;
  }

  return false;
}

module.exports = {
  buildDuplicateKey,
  buildSubmissionPayload,
  responseLooksDuplicate,
  responseLooksOk,
  sha256Hex,
};
