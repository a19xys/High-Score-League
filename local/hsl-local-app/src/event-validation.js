const { getGameByRom } = require("./games");

const ALLOWED_SOURCES = new Set([
  "web",
  "mame_memory",
  "mame_plugin",
  "local_app",
  "admin_import",
]);

function validateEvent(event) {
  const errors = [];
  const warnings = [];
  let normalizedGame = null;

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return {
      errors: ["El evento no es un objeto JSON válido"],
      warnings,
    };
  }

  if (event.schemaVersion !== 1) {
    errors.push("schemaVersion debe ser 1");
  }

  if (!event.rom || typeof event.rom !== "string") {
    errors.push("rom debe ser un string");
  } else {
    normalizedGame = getGameByRom(event.rom);
  }

  if (!Number.isInteger(event.score) || event.score < 0) {
    errors.push("score debe ser un entero >= 0");
  }

  if (!event.detectedAt || typeof event.detectedAt !== "string") {
    errors.push("detectedAt debe ser un string ISO");
  } else {
    const date = new Date(event.detectedAt);
    if (Number.isNaN(date.getTime())) {
      errors.push("detectedAt no es una fecha válida");
    }
  }

  if (!event.source || typeof event.source !== "string") {
    errors.push("source debe ser un string");
  } else if (!ALLOWED_SOURCES.has(event.source)) {
    errors.push(`source no permitido: ${event.source}`);
  }

  if (!event.game || typeof event.game !== "string") {
    warnings.push("game falta o no es string");
  }

  if (!event.pluginVersion || typeof event.pluginVersion !== "string") {
    warnings.push("pluginVersion falta o no es string");
  }

  if (!event.mameVersion || typeof event.mameVersion !== "string") {
    warnings.push("mameVersion falta o no es string");
  }

  if (!event.detection || typeof event.detection !== "object") {
    warnings.push("detection falta o no es objeto");
  } else {
    if (typeof event.detection.manualConfirm !== "boolean") {
      warnings.push("detection.manualConfirm falta o no es boolean");
    }

    if (typeof event.detection.gameOverDetected !== "boolean") {
      warnings.push("detection.gameOverDetected falta o no es boolean");
    }

    if (!event.detection.method || typeof event.detection.method !== "string") {
      warnings.push("detection.method falta o no es string");
    }
  }

  if (!event.scoreData || typeof event.scoreData !== "object") {
    warnings.push("scoreData falta o no es objeto");
  } else {
    if (
      event.scoreData.trackedScore !== undefined &&
      (!Number.isInteger(event.scoreData.trackedScore) || event.scoreData.trackedScore < 0)
    ) {
      warnings.push("scoreData.trackedScore debería ser entero >= 0");
    }

    if (
      event.scoreData.displayScore !== undefined &&
      (!Number.isInteger(event.scoreData.displayScore) || event.scoreData.displayScore < 0)
    ) {
      warnings.push("scoreData.displayScore debería ser entero >= 0");
    }

    if (
      event.scoreData.rollovers !== undefined &&
      (!Number.isInteger(event.scoreData.rollovers) || event.scoreData.rollovers < 0)
    ) {
      warnings.push("scoreData.rollovers debería ser entero >= 0");
    }
  }

  return { errors, warnings, normalizedGame };
}

module.exports = {
  ALLOWED_SOURCES,
  validateEvent,
};
