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
  "menu_opened", "speed_changed", "throttle_changed", "run_input_changed", "integrity_unavailable",
]);
const COMPETITION_VIOLATION_SET = new Set(COMPETITION_VIOLATIONS);

function isBoundedString(value, maximum = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function dipsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCompetitionProvenance(provenance, expected = null) {
  const errors = [];
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return { errors: ["competitionIntegrity.provenance debe ser un objeto"], normalized: null };
  }
  if (Object.keys(provenance).sort().join(",") !== "artifactSha256,artifactSizeBytes,competitionManifestSha256,mode") {
    errors.push("competitionIntegrity.provenance contiene campos desconocidos");
  }
  if (!["remote_verified", "developer_override"].includes(provenance.mode)) {
    errors.push("competitionIntegrity.provenance.mode es invalido");
  }
  if (typeof provenance.competitionManifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(provenance.competitionManifestSha256)) {
    errors.push("competitionIntegrity.provenance.competitionManifestSha256 es invalido");
  }
  if (provenance.mode === "remote_verified") {
    if (typeof provenance.artifactSha256 !== "string" || !/^[0-9a-f]{64}$/.test(provenance.artifactSha256)) {
      errors.push("competitionIntegrity.provenance.artifactSha256 es invalido");
    }
    if (!Number.isSafeInteger(provenance.artifactSizeBytes) || provenance.artifactSizeBytes <= 0) {
      errors.push("competitionIntegrity.provenance.artifactSizeBytes es invalido");
    }
  } else if (provenance.artifactSha256 !== null || provenance.artifactSizeBytes !== null) {
    errors.push("developer_override no puede declarar identidad de artifact productiva");
  }
  if (expected && JSON.stringify(provenance) !== JSON.stringify(expected)) {
    errors.push("competitionIntegrity.provenance no coincide con la run protegida");
  }
  return { errors, normalized: errors.length === 0 ? { ...provenance } : null };
}

function validateCompetitionEventBinding(binding) {
  const errors = [];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return { errors: ["competitionIntegrity.event debe ser un objeto"], normalized: null };
  }
  if (Object.keys(binding).sort().join(",") !== "candidateId,detectedAt,rom,score,source") {
    errors.push("competitionIntegrity.event contiene campos desconocidos");
  }
  if (!isBoundedString(binding.candidateId, 192)) errors.push("competitionIntegrity.event.candidateId es invalido");
  if (!isBoundedString(binding.rom, 64)) errors.push("competitionIntegrity.event.rom es invalido");
  if (!Number.isSafeInteger(binding.score) || binding.score <= 0) errors.push("competitionIntegrity.event.score es invalido");
  if (!isBoundedString(binding.detectedAt, 64) || Number.isNaN(new Date(binding.detectedAt).getTime())) {
    errors.push("competitionIntegrity.event.detectedAt es invalido");
  }
  if (binding.source !== "mame_memory") errors.push("competitionIntegrity.event.source es invalido");
  return { errors, normalized: errors.length === 0 ? { ...binding } : null };
}

function validateCompetitionIntegrity(integrity, expected = null) {
  const errors = [];
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    return { errors: ["competitionIntegrity debe ser un objeto"], normalized: null };
  }
  const version = integrity.version;
  const v1Fields = "dips,event,guardVersion,mameVersion,manifestSha256,packId,pluginVersion,provenance,runId,version,violations";
  const v2Fields = "captureClientVersion,dips,event,guardVersion,mameVersion,manifestSha256,packId,playerBinding,pluginVersion,provenance,runId,runInputManifestSha256,version,violations,weekId";
  const actualFields = Object.keys(integrity).sort().join(",");
  if ((version === 1 && actualFields !== v1Fields) || (version === 2 && actualFields !== v2Fields)
      || ![1, 2].includes(version)) {
    errors.push("competitionIntegrity contiene campos desconocidos");
  }
  if (![1, 2].includes(version)) errors.push("competitionIntegrity.version debe ser 1 o 2");
  if (integrity.guardVersion !== version) errors.push(`competitionIntegrity.guardVersion debe ser ${version}`);
  if (!isBoundedString(integrity.runId)) errors.push("competitionIntegrity.runId es invalido");
  if (!isBoundedString(integrity.packId)) errors.push("competitionIntegrity.packId es invalido");
  if (typeof integrity.manifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(integrity.manifestSha256)) {
    errors.push("competitionIntegrity.manifestSha256 es invalido");
  }
  if (!isBoundedString(integrity.mameVersion, 32)) errors.push("competitionIntegrity.mameVersion es invalido");
  if (!isBoundedString(integrity.pluginVersion, 32)) errors.push("competitionIntegrity.pluginVersion es invalido");
  if (version === 2) {
    if (!isBoundedString(integrity.weekId)) errors.push("competitionIntegrity.weekId es invalido");
    if (typeof integrity.playerBinding !== "string" || !/^[0-9a-f]{64}$/.test(integrity.playerBinding)) {
      errors.push("competitionIntegrity.playerBinding es invalido");
    }
    if (!isBoundedString(integrity.captureClientVersion, 32)) errors.push("competitionIntegrity.captureClientVersion es invalido");
    if (typeof integrity.runInputManifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(integrity.runInputManifestSha256)) {
      errors.push("competitionIntegrity.runInputManifestSha256 es invalido");
    }
  }

  const provenance = validateCompetitionProvenance(integrity.provenance, expected?.provenance || null);
  errors.push(...provenance.errors);
  const eventBinding = validateCompetitionEventBinding(integrity.event);
  errors.push(...eventBinding.errors);
  if (integrity.provenance?.competitionManifestSha256 !== integrity.manifestSha256) {
    errors.push("competitionIntegrity.provenance no coincide con manifestSha256");
  }

  const dips = [];
  const seen = new Set();
  if (!Array.isArray(integrity.dips) || integrity.dips.length > 32) {
    errors.push("competitionIntegrity.dips debe ser un array de hasta 32 entradas");
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
    const boundFields = ["runId", "packId", "manifestSha256", "mameVersion", "pluginVersion"];
    if (version === 2) boundFields.push("weekId", "playerBinding", "captureClientVersion", "runInputManifestSha256");
    for (const field of boundFields) {
      if (expected[field] !== undefined && integrity[field] !== expected[field]) errors.push(`competitionIntegrity.${field} no coincide con el run protegido`);
    }
    if (expected.dips && !dipsEqual(dips, expected.dips)) errors.push("competitionIntegrity.dips no coincide con el run protegido");
  }

  return { errors, normalized: errors.length === 0 ? {
    ...integrity,
    dips,
    event: eventBinding.normalized,
    provenance: provenance.normalized,
  } : null };
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
    if (integrity.normalized) {
      const binding = integrity.normalized.event;
      for (const field of ["candidateId", "rom", "score", "detectedAt", "source"]) {
        if (event[field] !== binding[field]) errors.push(`${field} no coincide con competitionIntegrity.event.${field}`);
      }
      if (event.runId !== integrity.normalized.runId) errors.push("runId no coincide con competitionIntegrity.runId");
      if (event.packId !== integrity.normalized.packId) errors.push("packId no coincide con competitionIntegrity.packId");
      if (event.mameVersion !== integrity.normalized.mameVersion) errors.push("mameVersion no coincide con competitionIntegrity.mameVersion");
      if (event.pluginVersion !== integrity.normalized.pluginVersion) errors.push("pluginVersion no coincide con competitionIntegrity.pluginVersion");
    }
  }

  return { errors, warnings, normalizedGame };
}

module.exports = {
  ALLOWED_SOURCES,
  COMPETITION_VIOLATIONS,
  validateCompetitionEventBinding,
  validateCompetitionIntegrity,
  validateCompetitionProvenance,
  validateEvent,
};
