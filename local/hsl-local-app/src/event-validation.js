const { getGameByRom } = require("./games");

const ALLOWED_SOURCES = new Set([
  "web",
  "mame_memory",
  "mame_plugin",
  "local_app",
  "admin_import",
]);
const COMPETITION_VIOLATIONS = Object.freeze([
  "dip_changed", "pause", "state_save", "state_load", "machine_reset",
  "menu_opened", "speed_changed", "throttle_changed", "integrity_unavailable",
]);
const COMPETITION_VIOLATION_SET = new Set(COMPETITION_VIOLATIONS);

function isBoundedString(value, maximum = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function dipsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCompetitionIntegrity(integrity, expected = null) {
  const errors = [];
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    return { errors: ["competitionIntegrity debe ser un objeto"], normalized: null };
  }
  if (Object.keys(integrity).sort().join(",") !== "dips,guardVersion,mameVersion,manifestSha256,packId,runId,version,violations") {
    errors.push("competitionIntegrity contiene campos desconocidos");
  }
  if (integrity.version !== 1) errors.push("competitionIntegrity.version debe ser 1");
  if (integrity.guardVersion !== 1) errors.push("competitionIntegrity.guardVersion debe ser 1");
  if (!isBoundedString(integrity.runId)) errors.push("competitionIntegrity.runId es invalido");
  if (!isBoundedString(integrity.packId)) errors.push("competitionIntegrity.packId es invalido");
  if (typeof integrity.manifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(integrity.manifestSha256)) {
    errors.push("competitionIntegrity.manifestSha256 es invalido");
  }
  if (!isBoundedString(integrity.mameVersion, 32)) errors.push("competitionIntegrity.mameVersion es invalido");

  const dips = [];
  const seen = new Set();
  if (!Array.isArray(integrity.dips) || integrity.dips.length === 0 || integrity.dips.length > 32) {
    errors.push("competitionIntegrity.dips debe ser un array no vacio de hasta 32 entradas");
  } else {
    let previous = null;
    for (const dip of integrity.dips) {
      const validObject = dip && typeof dip === "object" && !Array.isArray(dip);
      if (validObject && Object.keys(dip).sort().join(",") !== "mask,portTag,value") {
        errors.push("competitionIntegrity.dips contiene campos desconocidos");
      }
      const validPort = validObject && isBoundedString(dip.portTag);
      const validMask = validObject && Number.isSafeInteger(dip.mask) && dip.mask > 0 && dip.mask <= 0xffffffff;
      const validValue = validObject && Number.isSafeInteger(dip.value) && dip.value >= 0 && dip.value <= 0xffffffff;
      if (!validObject || !validPort || !validMask || !validValue || (validMask && validValue && (BigInt(dip.value) & ~BigInt(dip.mask)) !== 0n)) {
        errors.push("competitionIntegrity.dips contiene una entrada invalida");
        continue;
      }
      const normalized = { portTag: dip.portTag, mask: dip.mask, value: dip.value };
      const key = `${dip.portTag}\u0000${dip.mask}`;
      if (seen.has(key)) errors.push("competitionIntegrity.dips contiene entradas duplicadas");
      if (previous && (previous.portTag > dip.portTag || (previous.portTag === dip.portTag && previous.mask >= dip.mask))) {
        errors.push("competitionIntegrity.dips no esta en orden canonico");
      }
      seen.add(key);
      previous = normalized;
      dips.push(normalized);
    }
  }

  if (!Array.isArray(integrity.violations)) {
    errors.push("competitionIntegrity.violations debe ser un array");
  } else {
    let previousIndex = -1;
    const violationSeen = new Set();
    for (const code of integrity.violations) {
      const index = COMPETITION_VIOLATIONS.indexOf(code);
      if (!COMPETITION_VIOLATION_SET.has(code)) errors.push(`competitionIntegrity.violations contiene un codigo desconocido: ${code}`);
      else if (violationSeen.has(code) || index <= previousIndex) errors.push("competitionIntegrity.violations debe estar deduplicado y en orden canonico");
      violationSeen.add(code);
      previousIndex = index;
    }
  }

  if (expected) {
    for (const field of ["runId", "packId", "manifestSha256", "mameVersion"]) {
      if (expected[field] !== undefined && integrity[field] !== expected[field]) errors.push(`competitionIntegrity.${field} no coincide con el run protegido`);
    }
    if (expected.dips && !dipsEqual(dips, expected.dips)) errors.push("competitionIntegrity.dips no coincide con el run protegido");
  }

  return { errors, normalized: errors.length === 0 ? { ...integrity, dips } : null };
}

function validateEvent(event, options = {}) {
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

  if (event.competitionIntegrity !== undefined || options.competitionGuard) {
    const integrity = validateCompetitionIntegrity(event.competitionIntegrity, options.competitionGuard || null);
    errors.push(...integrity.errors);
  }

  return { errors, warnings, normalizedGame };
}

module.exports = {
  ALLOWED_SOURCES,
  COMPETITION_VIOLATIONS,
  validateCompetitionIntegrity,
  validateEvent,
};
