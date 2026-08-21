const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { COMPETITION_VIOLATIONS, validateEvent } = require("./event-validation");
const { writeRejectionNote } = require("./file-queue");
const { getTitleByRom } = require("./games");

const MAX_LEDGER_BYTES = 64 * 1024;
const MAX_CANDIDATE_BYTES = 256 * 1024;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 32;
const MAX_METADATA_ARRAY = 64;
const MAX_METADATA_NODES = 256;
const MAX_METADATA_STRING = 512;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

class CompetitionFinalizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CompetitionFinalizationError";
    this.code = code;
  }
}

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function isBoundedString(value, maximum = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalViolations(values) {
  const present = new Set(values || []);
  return COMPETITION_VIOLATIONS.filter((code) => present.has(code));
}

function addIntegrityUnavailable(values) {
  return canonicalViolations([...(values || []), "integrity_unavailable"]);
}

async function readSmallJson(filePath, maximumBytes = MAX_LEDGER_BYTES) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new CompetitionFinalizationError("invalid_file", `Archivo no regular o fuera de limite: ${path.basename(filePath)}`);
  }
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

function validateIdentity(value, expected) {
  if (!sameKeys(value, ["version", "runId", "packId", "manifestSha256", "mameVersion", "pluginVersion"])) {
    throw new CompetitionFinalizationError("invalid_identity", "identity.json contiene campos desconocidos.");
  }
  if (value.version !== 1 || !isBoundedString(value.runId) || !isBoundedString(value.packId)
      || !SHA256_PATTERN.test(value.manifestSha256 || "") || !isBoundedString(value.mameVersion, 32)
      || !isBoundedString(value.pluginVersion, 32)) {
    throw new CompetitionFinalizationError("invalid_identity", "identity.json es invalido.");
  }
  for (const field of ["runId", "packId", "manifestSha256", "mameVersion", "pluginVersion"]) {
    if (value[field] !== expected[field]) {
      throw new CompetitionFinalizationError("identity_mismatch", `identity.json no coincide en ${field}.`);
    }
  }
  return value;
}

function validateArmedMarker(value, identity) {
  if (!sameKeys(value, ["version", "runId"]) || value.version !== 1 || value.runId !== identity.runId) {
    throw new CompetitionFinalizationError("invalid_armed_marker", "armed.marker no acredita esta run.");
  }
}

function validateFinalMarker(value, identity) {
  if (!sameKeys(value, [
    "version", "runId", "packId", "manifestSha256", "mameVersion", "pluginVersion", "exitPending",
  ]) || value.version !== 1 || value.exitPending !== true) {
    throw new CompetitionFinalizationError("invalid_final_marker", "final.marker es invalido.");
  }
  for (const field of ["runId", "packId", "manifestSha256", "mameVersion", "pluginVersion"]) {
    if (value[field] !== identity[field]) {
      throw new CompetitionFinalizationError("final_marker_mismatch", `final.marker no coincide en ${field}.`);
    }
  }
}

function validateState(value, identity, violations) {
  if (!sameKeys(value, ["version", "runId", "packId", "phase", "armed", "stopObserved", "violations"])) {
    throw new CompetitionFinalizationError("invalid_state", "state.json contiene campos desconocidos.");
  }
  const expectedPhase = violations.length > 0 ? "violated" : "armed";
  if (value.version !== 1 || value.runId !== identity.runId || value.packId !== identity.packId
      || value.phase !== expectedPhase || value.armed !== true || value.stopObserved !== true
      || JSON.stringify(value.violations) !== JSON.stringify(violations)) {
    throw new CompetitionFinalizationError("invalid_state", "state.json no acredita la finalizacion durable de esta run.");
  }
}

async function readRunLedger(run) {
  const identity = validateIdentity(
    await readSmallJson(path.join(run.integrityDir, "identity.json")),
    run.integrity,
  );
  validateArmedMarker(await readSmallJson(path.join(run.integrityDir, "armed.marker")), identity);

  const entries = await fsp.readdir(run.integrityDir, { withFileTypes: true });
  const observed = [];
  for (const entry of entries) {
    if (!entry.name.startsWith("violation.")) continue;
    const match = /^violation\.([a-z_]+)\.marker$/.exec(entry.name);
    if (!match || !COMPETITION_VIOLATIONS.includes(match[1]) || !entry.isFile()) {
      throw new CompetitionFinalizationError("unknown_violation_marker", `Marker de violacion no reconocido: ${entry.name}`);
    }
    const value = await readSmallJson(path.join(run.integrityDir, entry.name));
    if (!sameKeys(value, ["version", "runId", "code"]) || value.version !== 1
        || value.runId !== identity.runId || value.code !== match[1]) {
      throw new CompetitionFinalizationError("invalid_violation_marker", `Marker de violacion invalido: ${entry.name}`);
    }
    observed.push(match[1]);
  }
  const violations = canonicalViolations(observed);
  if (violations.length !== observed.length) {
    throw new CompetitionFinalizationError("duplicate_violation_marker", "Los markers de violacion no son canonicos.");
  }

  validateFinalMarker(await readSmallJson(path.join(run.integrityDir, "final.marker")), identity);
  validateState(await readSmallJson(path.join(run.integrityDir, "state.json")), identity, violations);
  return { identity, violations };
}

function sanitizeMetadata(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > MAX_METADATA_NODES) throw new Error("metadata supera el limite de nodos");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("metadata contiene NaN/Infinity");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_METADATA_STRING || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("metadata contiene un string invalido");
    return value;
  }
  if (!value || typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
    throw new Error("metadata contiene un tipo no JSON");
  }
  if (depth >= MAX_METADATA_DEPTH) throw new Error("metadata supera la profundidad maxima");
  const keys = Object.keys(value);
  if (keys.length > MAX_METADATA_KEYS) throw new Error("metadata supera el limite de keys");
  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ARRAY) throw new Error("metadata supera el limite de array");
    return value.map((child) => sanitizeMetadata(child, depth + 1, budget));
  }
  const clean = {};
  for (const key of keys) {
    if (!isBoundedString(key, 64)) throw new Error("metadata contiene una key invalida");
    clean[key] = sanitizeMetadata(value[key], depth + 1, budget);
  }
  return clean;
}

function validateCandidate(value, run) {
  const fields = [
    "version", "candidateId", "runId", "rom", "score", "detectedAt", "source",
    "mameVersion", "pluginVersion", "strategy", "metadata",
  ];
  if (!sameKeys(value, fields)) throw new Error("candidate contiene campos desconocidos");
  if (value.version !== 1 || !isBoundedString(value.candidateId, 192)
      || value.runId !== run.runId || value.rom !== run.config.pack.rom
      || !Number.isSafeInteger(value.score) || value.score <= 0 || value.score > 999999999
      || !isBoundedString(value.detectedAt, 64) || Number.isNaN(new Date(value.detectedAt).getTime())
      || value.source !== "mame_memory" || value.mameVersion !== run.integrity.mameVersion
      || value.pluginVersion !== run.integrity.pluginVersion
      || value.strategy !== run.automaticCaptureStrategy) {
    throw new Error("candidate no coincide con la identidad protegida de la run");
  }
  if (!new RegExp(`^${run.runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_candidate_[0-9]{6}$`).test(value.candidateId)) {
    throw new Error("candidateId no pertenece a esta run");
  }
  return Object.freeze({ ...value, metadata: sanitizeMetadata(value.metadata) });
}

async function readCandidates(run) {
  const entries = await fsp.readdir(run.stagingCandidatesDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const candidates = [];
  const invalid = [];
  const ids = new Set();
  for (const entry of entries) {
    const filePath = path.join(run.stagingCandidatesDir, entry.name);
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      invalid.push({ entry: entry.name, error: "entrada de candidate no permitida", filePath, raw: null });
      continue;
    }
    let raw = null;
    try {
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CANDIDATE_BYTES) {
        throw new Error("candidate no regular o fuera de limite");
      }
      raw = await fsp.readFile(filePath);
      const candidate = validateCandidate(JSON.parse(raw.toString("utf8")), run);
      if (ids.has(candidate.candidateId)) throw new Error("candidateId duplicado");
      ids.add(candidate.candidateId);
      candidates.push({ candidate, entry: entry.name, filePath, raw });
    } catch (error) {
      invalid.push({ entry: entry.name, error: error.message, filePath, raw });
    }
  }
  return { candidates, invalid };
}

function buildCompetitionIntegrity(run, candidate, violations) {
  return {
    version: 1,
    guardVersion: 1,
    runId: run.runId,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    dips: run.integrity.dips.map(({ portTag, mask, value }) => ({ portTag, mask, value })),
    violations,
    provenance: { ...run.provenance },
    event: {
      candidateId: candidate.candidateId,
      rom: candidate.rom,
      score: candidate.score,
      detectedAt: candidate.detectedAt,
      source: candidate.source,
    },
  };
}

function buildFinalEvent(run, candidate, violations) {
  const metadata = candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
  const numericOr = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  return {
    schemaVersion: 1,
    candidateId: candidate.candidateId,
    runId: run.runId,
    packId: run.integrity.packId,
    game: getTitleByRom(candidate.rom) || run.config.pack.gameId,
    rom: candidate.rom,
    score: candidate.score,
    detectedAt: candidate.detectedAt,
    source: candidate.source,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    detection: {
      method: "automatic_adapter_candidate_v1",
      manualConfirm: false,
      gameOverDetected: metadata.gameOverDetected === true,
      strategy: run.automaticCaptureStrategy,
    },
    scoreData: {
      displayScore: numericOr(metadata.displayScore, candidate.score),
      trackedScore: numericOr(metadata.trackedScore, candidate.score),
      rollovers: numericOr(metadata.rollovers, 0),
    },
    captureMetadata: metadata,
    competitionIntegrity: buildCompetitionIntegrity(run, candidate, violations),
  };
}

function safeEventFilename(candidateId) {
  return `competition_${crypto.createHash("sha256").update(candidateId).digest("hex").slice(0, 32)}.json`;
}

async function publishAtomic(targetPath, bytes) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
  try {
    await fsp.copyFile(temporaryPath, targetPath, fs.constants.COPYFILE_EXCL);
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => null);
  }
}

async function publishRejected(scopedRejectedDir, filename, bytes, reason) {
  const targetPath = path.join(scopedRejectedDir, filename);
  await publishAtomic(targetPath, bytes);
  const notePath = await writeRejectionNote({ eventsRejectedDirAbs: scopedRejectedDir }, filename, {
    domainCode: "LOCAL_COMPETITION_INTEGRITY",
    httpStatus: 0,
    reason,
  });
  return { filename, finalPath: targetPath, notePath };
}

async function readExistingFinalization(finalizationPath, runId) {
  try {
    const value = await readSmallJson(finalizationPath);
    if (value?.version !== 1 || value?.runId !== runId || !Array.isArray(value.adopted) || !Array.isArray(value.rejected)) {
      throw new CompetitionFinalizationError("invalid_finalization_record", "finalization.json es invalido.");
    }
    return { ...value, alreadyFinalized: true };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function finalizeCompetitionRun(run, scope, options = {}) {
  if (!run?.runId || !run?.integrityDir || !run?.stagingCandidatesDir || !run?.config?.pack) {
    throw new CompetitionFinalizationError("invalid_run", "No se recibio una run competitiva preparada.");
  }
  if (!scope?.scopedPendingDir || !scope?.scopedRejectedDir) {
    throw new CompetitionFinalizationError("invalid_scope", "No se recibio una cola scoped completa.");
  }
  const finalizationPath = path.join(run.integrityDir, "finalization.json");
  const existing = await readExistingFinalization(finalizationPath, run.runId);
  if (existing) return existing;

  let ledger = { violations: [] };
  let failClosedReason = null;
  try {
    if (options.exitCode !== 0) throw new CompetitionFinalizationError("process_exit", `MAME termino con codigo ${options.exitCode}.`);
    ledger = await readRunLedger(run);
  } catch (error) {
    failClosedReason = `${error.code || error.name || "integrity_unavailable"}: ${error.message}`;
  }

  const candidateSet = await readCandidates(run);
  if (candidateSet.invalid.length > 0 && !failClosedReason) {
    failClosedReason = `invalid_candidate: ${candidateSet.invalid.map((item) => `${item.entry}: ${item.error}`).join("; ")}`;
  }
  let status = failClosedReason ? "fail_closed" : ledger.violations.length > 0 ? "violated" : "clean";
  let violations = status === "clean"
    ? []
    : status === "violated"
      ? ledger.violations
      : addIntegrityUnavailable(ledger.violations);
  const adopted = [];
  const rejected = [];

  let finalEvents = candidateSet.candidates.map((item) => ({
    item,
    event: buildFinalEvent(run, item.candidate, violations),
  }));
  const invalidFinalEvents = finalEvents.flatMap(({ item, event }) => {
    const validation = validateEvent(event, { competitionGuard: run.integrity });
    return validation.errors.length > 0 ? [`${item.entry}: ${validation.errors.join("; ")}`] : [];
  });
  if (invalidFinalEvents.length > 0) {
    failClosedReason = failClosedReason || `final_event_invalid: ${invalidFinalEvents.join("; ")}`;
    status = "fail_closed";
    violations = addIntegrityUnavailable(violations);
    finalEvents = candidateSet.candidates.map((item) => ({
      item,
      event: buildFinalEvent(run, item.candidate, violations),
    }));
  }

  for (const { item, event } of finalEvents) {
    const filename = safeEventFilename(item.candidate.candidateId);
    const bytes = Buffer.from(`${JSON.stringify(event, null, 2)}\n`);
    if (status === "clean") {
      const finalPath = path.join(scope.scopedPendingDir, filename);
      await publishAtomic(finalPath, bytes);
      adopted.push({ filename, finalPath, restoredFilename: filename });
    } else {
      const reason = status === "violated"
        ? `Partida no valida por integridad competitiva: ${violations.join(", ")}.`
        : `No se pudo acreditar una finalizacion competitiva limpia: ${failClosedReason}`;
      rejected.push(await publishRejected(scope.scopedRejectedDir, filename, bytes, reason));
    }
  }

  for (const item of candidateSet.invalid) {
    const filename = `invalid_${crypto.createHash("sha256").update(`${run.runId}:${item.entry}`).digest("hex").slice(0, 32)}.json`;
    const raw = item.raw || Buffer.from(`${JSON.stringify({ invalidCandidate: item.entry })}\n`);
    rejected.push(await publishRejected(
      scope.scopedRejectedDir,
      filename,
      raw,
      `Candidate no valido; la run fallo cerrado: ${item.error}`,
    ));
  }

  const result = {
    version: 1,
    runId: run.runId,
    status,
    violations,
    failClosedReason,
    candidateCount: candidateSet.candidates.length + candidateSet.invalid.length,
    adopted,
    rejected,
    finalizedAt: (options.now || new Date()).toISOString(),
  };
  await publishAtomic(finalizationPath, Buffer.from(`${JSON.stringify(result, null, 2)}\n`));
  return result;
}

module.exports = {
  CompetitionFinalizationError,
  buildFinalEvent,
  finalizeCompetitionRun,
  readRunLedger,
  sanitizeMetadata,
  validateCandidate,
};
