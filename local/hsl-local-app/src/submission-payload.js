const crypto = require("crypto");
const { getGameByRom } = require("./games");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildDuplicateKey(config, event, storedSession) {
  const evidence = event.competitionIntegrity;
  if (evidence?.version === 2) {
    const stableParts = [
      "hsl", "v2", evidence.weekId, evidence.playerBinding, evidence.packId,
      evidence.manifestSha256, evidence.runId, event.candidateId,
    ];
    return `hsl:v2:${sha256Hex(stableParts.join("|"))}`;
  }
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
  // Registry lookup is intentionally side-effect free in this phase.
  getGameByRom(event.rom);

  const capturedWeekId = event.competitionIntegrity?.version === 2
    ? event.competitionIntegrity.weekId
    : config.defaultWeekId;

  return {
    weekId: capturedWeekId,
    score: event.score,
    detectedAt: event.detectedAt,
    source: event.source,
    rom: event.rom,
    mameVersion: event.mameVersion || undefined,
    clientVersion: config.clientVersion || require("../package.json").version,
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

  if (typeof body.code === "string" && body.code.trim()) {
    return false;
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
