const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { COMPETITION_VIOLATIONS, validateEvent } = require("./event-validation");
const { getTitleByRom } = require("./games");
const {
  MAME_EXIT_FILENAME,
  PREPARED_MARKER_FILENAME,
  PREPARING_MARKER_FILENAME,
  RUN_INPUT_MANIFEST_FILENAME,
  atomicWriteBytes,
  canonicalJsonBytes,
  readRunInputState,
  sha256Bytes,
} = require("./run-input-integrity");

const MAX_LEDGER_BYTES = 64 * 1024;
const MAX_CANDIDATE_BYTES = 256 * 1024;
const MAX_CANDIDATES = 128;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 32;
const MAX_METADATA_ARRAY = 64;
const MAX_METADATA_NODES = 256;
const MAX_METADATA_STRING = 512;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FORBIDDEN_METADATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PLAN_FILENAME = "finalization-plan.json";
const COMMIT_FILENAME = "finalization.json";
const FINALIZATION_STAGING_DIR = "finalization-staging";
const RECOVERY_STATUS_FILENAME = "recovery-status.json";

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

async function readSmallFile(filePath, maximumBytes = MAX_LEDGER_BYTES) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 0 || stat.size > maximumBytes) {
    throw new CompetitionFinalizationError("invalid_file", `Archivo no regular o fuera de limite: ${path.basename(filePath)}`);
  }
  return fsp.readFile(filePath);
}

async function readSmallJson(filePath, maximumBytes = MAX_LEDGER_BYTES) {
  const bytes = await readSmallFile(filePath, maximumBytes);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CompetitionFinalizationError("invalid_json", `${path.basename(filePath)} no contiene JSON valido: ${error.message}`);
  }
}

function validateIdentity(value, expected) {
  const fields = [
    "version", "guardVersion", "runId", "packId", "manifestSha256", "mameVersion",
    "pluginVersion", "weekId", "playerBinding", "captureClientVersion",
  ];
  if (!sameKeys(value, fields) || value.version !== 2 || value.guardVersion !== 2
      || !isBoundedString(value.runId) || !isBoundedString(value.packId)
      || !SHA256_PATTERN.test(value.manifestSha256 || "") || !isBoundedString(value.mameVersion, 32)
      || !isBoundedString(value.pluginVersion, 32) || !isBoundedString(value.weekId)
      || !SHA256_PATTERN.test(value.playerBinding || "") || !isBoundedString(value.captureClientVersion, 32)) {
    throw new CompetitionFinalizationError("invalid_identity", "identity.json v2 es invalido.");
  }
  for (const field of fields.slice(2)) {
    if (expected[field] !== undefined && value[field] !== expected[field]) {
      throw new CompetitionFinalizationError("identity_mismatch", `identity.json no coincide en ${field}.`);
    }
  }
  return value;
}

function validateArmedMarker(value, identity) {
  if (!sameKeys(value, ["version", "runId"]) || value.version !== 2 || value.runId !== identity.runId) {
    throw new CompetitionFinalizationError("invalid_armed_marker", "armed.marker no acredita esta run v2.");
  }
}

function validateCandidateSet(value, identity) {
  if (!sameKeys(value, [
    "version", "runId", "packId", "manifestSha256", "mameVersion", "pluginVersion",
    "exitPending", "candidateCount", "candidates",
  ]) || value.version !== 2 || value.exitPending !== true
      || !Number.isSafeInteger(value.candidateCount) || value.candidateCount < 0
      || value.candidateCount > MAX_CANDIDATES || !Array.isArray(value.candidates)
      || value.candidates.length !== value.candidateCount) {
    throw new CompetitionFinalizationError("invalid_final_marker", "final.marker no compromete un conjunto valido.");
  }
  for (const field of ["runId", "packId", "manifestSha256", "mameVersion", "pluginVersion"]) {
    if (value[field] !== identity[field]) {
      throw new CompetitionFinalizationError("final_marker_mismatch", `final.marker no coincide en ${field}.`);
    }
  }
  const expected = [];
  for (let index = 0; index < value.candidates.length; index += 1) {
    const sequence = index + 1;
    const item = value.candidates[index];
    const suffix = String(sequence).padStart(6, "0");
    const record = {
      sequence,
      candidateId: `${identity.runId}_candidate_${suffix}`,
      candidateFile: `candidate_${suffix}.json`,
      commitmentFile: `commitment_${suffix}.json`,
    };
    if (!sameKeys(item, Object.keys(record))
        || Object.entries(record).some(([key, expectedValue]) => item[key] !== expectedValue)) {
      throw new CompetitionFinalizationError("invalid_final_candidate_set", "El orden/identidad del final seal no es canonico.");
    }
    expected.push(record);
  }
  return expected;
}

function validateState(value, identity, violations) {
  if (!sameKeys(value, ["version", "runId", "packId", "phase", "armed", "stopObserved", "violations"])) {
    throw new CompetitionFinalizationError("invalid_state", "state.json contiene campos desconocidos.");
  }
  const expectedPhase = violations.length > 0 ? "violated" : "armed";
  if (value.version !== 2 || value.runId !== identity.runId || value.packId !== identity.packId
      || value.phase !== expectedPhase || value.armed !== true || value.stopObserved !== true
      || JSON.stringify(value.violations) !== JSON.stringify(violations)) {
    throw new CompetitionFinalizationError("invalid_state", "state.json no acredita el cierre durable de esta run.");
  }
}

async function readViolationMarkers(run, identity) {
  const entries = await fsp.readdir(run.integrityDir, { withFileTypes: true });
  const observed = [];
  for (const entry of entries) {
    if (!entry.name.startsWith("violation.")) continue;
    const match = /^violation\.([a-z_]+)\.marker$/.exec(entry.name);
    if (!match || !COMPETITION_VIOLATIONS.includes(match[1]) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new CompetitionFinalizationError("unknown_violation_marker", `Marker no reconocido: ${entry.name}`);
    }
    const value = await readSmallJson(path.join(run.integrityDir, entry.name));
    if (!sameKeys(value, ["version", "runId", "code"]) || value.version !== 2
        || value.runId !== identity.runId || value.code !== match[1]) {
      throw new CompetitionFinalizationError("invalid_violation_marker", `Marker invalido: ${entry.name}`);
    }
    observed.push(match[1]);
  }
  const violations = canonicalViolations(observed);
  if (violations.length !== observed.length) {
    throw new CompetitionFinalizationError("duplicate_violation_marker", "Los markers de violacion no son canonicos.");
  }
  return violations;
}

async function readMameExit(run, expectedExitCode) {
  const value = await readSmallJson(path.join(run.integrityDir, MAME_EXIT_FILENAME));
  if (!sameKeys(value, ["version", "runId", "exitCode", "observedAt"]) || value.version !== 1
      || value.runId !== run.runId || !Number.isInteger(value.exitCode)
      || !isBoundedString(value.observedAt, 64) || Number.isNaN(new Date(value.observedAt).getTime())) {
    throw new CompetitionFinalizationError("invalid_mame_exit", "mame-exit.json no acredita el cierre observado.");
  }
  if (Number.isInteger(expectedExitCode) && value.exitCode !== expectedExitCode) {
    throw new CompetitionFinalizationError("mame_exit_mismatch", "El exit code observado no coincide con el finalizer.");
  }
  if (value.exitCode !== 0) {
    throw new CompetitionFinalizationError("process_exit", `MAME termino con codigo ${value.exitCode}.`);
  }
  return value;
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
  if (!value || typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("metadata contiene un tipo no JSON");
  }
  if (depth >= MAX_METADATA_DEPTH) throw new Error("metadata supera la profundidad maxima");
  const keys = Object.keys(value);
  if (keys.length > MAX_METADATA_KEYS) throw new Error("metadata supera el limite de keys");
  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ARRAY) throw new Error("metadata supera el limite de array");
    return value.map((child) => sanitizeMetadata(child, depth + 1, budget));
  }
  const clean = Object.create(null);
  for (const key of keys) {
    if (!isBoundedString(key, 64) || FORBIDDEN_METADATA_KEYS.has(key)) throw new Error("metadata contiene una key prohibida");
    clean[key] = sanitizeMetadata(value[key], depth + 1, budget);
  }
  return clean;
}

function validateCandidate(value, run, expected = null) {
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
  if (expected && value.candidateId !== expected.candidateId) throw new Error("candidateId no coincide con el final seal");
  return Object.freeze({ ...value, metadata: sanitizeMetadata(value.metadata) });
}

async function exactDirectoryNames(dir, pattern) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !pattern.test(entry.name)) {
      throw new CompetitionFinalizationError("unexpected_candidate_entry", `Entrada no permitida: ${entry.name}`);
    }
    names.push(entry.name);
  }
  return names.sort();
}

async function readCandidates(run, sealedSet) {
  const candidateNames = await exactDirectoryNames(run.stagingCandidatesDir, /^candidate_[0-9]{6}\.json$/);
  const commitmentNames = await exactDirectoryNames(run.stagingCommitmentsDir, /^commitment_[0-9]{6}\.json$/);
  if (JSON.stringify(candidateNames) !== JSON.stringify(sealedSet.map((item) => item.candidateFile))
      || JSON.stringify(commitmentNames) !== JSON.stringify(sealedSet.map((item) => item.commitmentFile))) {
    throw new CompetitionFinalizationError("candidate_set_mismatch", "Candidates/commitments no coinciden exactamente con final.marker.");
  }
  const ledger = (await readSmallFile(run.candidateLedgerPath)).toString("utf8");
  const expectedLedger = sealedSet.map((item) => (
    `${item.sequence}\t${item.candidateId}\t${item.candidateFile}\t${item.commitmentFile}\n`
  )).join("");
  if (ledger !== expectedLedger) throw new CompetitionFinalizationError("candidate_ledger_mismatch", "candidate-set.log no coincide con final.marker.");

  const candidates = [];
  for (const expected of sealedSet) {
    const candidatePath = path.join(run.stagingCandidatesDir, expected.candidateFile);
    const commitmentPath = path.join(run.stagingCommitmentsDir, expected.commitmentFile);
    const candidateBytes = await readSmallFile(candidatePath, MAX_CANDIDATE_BYTES);
    const commitmentBytes = await readSmallFile(commitmentPath, MAX_CANDIDATE_BYTES * 2);
    let candidateValue;
    let commitment;
    try {
      candidateValue = JSON.parse(candidateBytes.toString("utf8"));
      commitment = JSON.parse(commitmentBytes.toString("utf8"));
    } catch (error) {
      throw new CompetitionFinalizationError("invalid_candidate_json", error.message);
    }
    const candidate = validateCandidate(candidateValue, run, expected);
    if (!sameKeys(commitment, ["version", "sequence", "candidateId", "candidate"])
        || commitment.version !== 1 || commitment.sequence !== expected.sequence
        || commitment.candidateId !== expected.candidateId
        || JSON.stringify(commitment.candidate) !== JSON.stringify(candidateValue)) {
      throw new CompetitionFinalizationError("candidate_commitment_mismatch", `${expected.candidateFile} no coincide exactamente con su commitment.`);
    }
    candidates.push({ candidate, candidateBytes, expected });
  }
  return candidates;
}

async function readRunLedger(run, options = {}) {
  const identity = validateIdentity(await readSmallJson(path.join(run.integrityDir, "identity.json")), run.integrity);
  validateArmedMarker(await readSmallJson(path.join(run.integrityDir, "armed.marker")), identity);
  await readMameExit(run, options.exitCode);
  const pluginViolations = await readViolationMarkers(run, identity);
  const appState = await readRunInputState(run).catch(() => ({ violations: ["integrity_unavailable"] }));
  const violations = canonicalViolations([...pluginViolations, ...(appState.violations || [])]);
  const sealedSet = validateCandidateSet(await readSmallJson(path.join(run.integrityDir, "final.marker")), identity);
  validateState(await readSmallJson(path.join(run.integrityDir, "state.json")), identity, pluginViolations);
  const candidates = await readCandidates(run, sealedSet);
  return { appState, candidates, identity, sealedSet, violations };
}

function buildCompetitionIntegrity(run, candidate, violations) {
  return {
    version: 2,
    guardVersion: 2,
    runId: run.runId,
    weekId: run.weekId,
    playerBinding: run.playerBinding,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    captureClientVersion: run.captureClientVersion,
    runInputManifestSha256: run.runInputManifestSha256,
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
  const metadata = candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : Object.create(null);
  const numericOr = (key, fallback) => Object.hasOwn(metadata, key)
    && Number.isSafeInteger(metadata[key]) && metadata[key] >= 0 ? metadata[key] : fallback;
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
      method: "automatic_adapter_candidate_v2",
      manualConfirm: false,
      gameOverDetected: Object.hasOwn(metadata, "gameOverDetected") && metadata.gameOverDetected === true,
      strategy: run.automaticCaptureStrategy,
    },
    scoreData: {
      displayScore: numericOr("displayScore", candidate.score),
      trackedScore: numericOr("trackedScore", candidate.score),
      rollovers: numericOr("rollovers", 0),
    },
    captureMetadata: metadata,
    competitionIntegrity: buildCompetitionIntegrity(run, candidate, violations),
  };
}

function safeEventFilename(candidateId) {
  return `competition_${crypto.createHash("sha256").update(candidateId).digest("hex").slice(0, 32)}.json`;
}

function receiptPathFor(scope, runId) {
  if (!scope?.scopedQueueRoot) throw new CompetitionFinalizationError("invalid_scope", "Falta scopedQueueRoot para el receipt.");
  return path.join(scope.scopedQueueRoot, "competition", "finalized", `${runId}.json`);
}

function outputDestination(scope, destination, filename) {
  if (path.basename(filename) !== filename) throw new CompetitionFinalizationError("invalid_output_name", "Nombre de output invalido.");
  if (destination === "pending") return path.join(scope.scopedPendingDir, filename);
  if (destination === "rejected") return path.join(scope.scopedRejectedDir, filename);
  if (destination === "rejected_note") return path.join(scope.scopedRejectedDir, filename);
  if (destination === "developer_qa") return path.join(scope.scopedQueueRoot, "competition", "qa", filename);
  throw new CompetitionFinalizationError("invalid_output_destination", `Destino logico desconocido: ${destination}`);
}

function rejectionNoteBytes(now, reason) {
  const clean = String(reason || "Rechazo local de integridad").replace(/[\r\n=]+/g, " ").slice(0, 240);
  return Buffer.from(`rejectedAt=${now}\nhttpStatus=0\ndomainCode=LOCAL_COMPETITION_INTEGRITY\nreason=${clean}\n`, "utf8");
}

function classifyStatus(provenance, violations, failClosedReason) {
  if (failClosedReason) return "fail_closed";
  if (violations.length > 0) return "violated";
  if (provenance?.mode === "developer_override") return "developer_qa";
  if (provenance?.mode === "remote_verified") return "clean";
  return "fail_closed";
}

async function stageFinalizationPlan(run, ledger, failClosedReason, options = {}) {
  const finalizedAt = (options.now || new Date()).toISOString();
  const violations = failClosedReason ? addIntegrityUnavailable(ledger.violations) : canonicalViolations(ledger.violations);
  let status = classifyStatus(run.provenance, violations, failClosedReason);
  if (status === "fail_closed" && !failClosedReason) failClosedReason = "provenance_mode_not_eligible";
  const destination = status === "clean" ? "pending" : status === "developer_qa" ? "developer_qa" : "rejected";
  const eventOutputs = [];
  for (const item of ledger.candidates || []) {
    const event = buildFinalEvent(run, item.candidate, violations);
    const validation = validateEvent(event, { competitionGuard: run.integrity });
    if (validation.errors.length > 0) {
      status = "fail_closed";
      failClosedReason = `final_event_invalid: ${validation.errors.join("; ")}`;
      break;
    }
    const filename = safeEventFilename(item.candidate.candidateId);
    const bytes = canonicalJsonBytes(event);
    eventOutputs.push({
      bytes,
      candidateId: item.candidate.candidateId,
      destination,
      filename,
      sha256: sha256Bytes(bytes),
    });
  }
  if (status === "fail_closed" && eventOutputs.length > 0) eventOutputs.length = 0;
  const finalViolations = status === "fail_closed" ? addIntegrityUnavailable(violations) : violations;
  const effectiveDestination = status === "clean" ? "pending" : status === "developer_qa" ? "developer_qa" : "rejected";
  for (const output of eventOutputs) output.destination = effectiveDestination;
  const receipt = {
    version: 1,
    runId: run.runId,
    weekId: run.weekId,
    playerBinding: run.playerBinding,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    runInputManifestSha256: run.runInputManifestSha256,
    captureClientVersion: run.captureClientVersion,
    provenance: { ...run.provenance },
    status,
    violations: finalViolations,
    outputs: eventOutputs.map(({ candidateId, destination: logicalDestination, filename, sha256 }) => ({
      candidateId, filename, sha256, destination: logicalDestination,
    })),
    finalizedAt,
  };
  const receiptBytes = canonicalJsonBytes(receipt);
  const stagingDir = path.join(run.integrityDir, FINALIZATION_STAGING_DIR);
  const plannedOutputs = [];
  for (let index = 0; index < eventOutputs.length; index += 1) {
    const output = eventOutputs[index];
    const stagedFile = `output-${String(index + 1).padStart(3, "0")}.bin`;
    await atomicWriteBytes(path.join(stagingDir, stagedFile), output.bytes);
    plannedOutputs.push({
      kind: "event", candidateId: output.candidateId, filename: output.filename,
      sha256: output.sha256, destination: output.destination, stagedFile,
    });
    if (output.destination === "rejected") {
      const noteFile = `${output.filename}.rejected.txt`;
      const noteBytes = rejectionNoteBytes(finalizedAt, failClosedReason || `Violaciones: ${finalViolations.join(", ")}`);
      const stagedNote = `output-${String(index + 1).padStart(3, "0")}.note`;
      await atomicWriteBytes(path.join(stagingDir, stagedNote), noteBytes);
      plannedOutputs.push({
        kind: "note", candidateId: output.candidateId, filename: noteFile,
        sha256: sha256Bytes(noteBytes), destination: "rejected_note", stagedFile: stagedNote,
      });
    }
  }
  await atomicWriteBytes(path.join(stagingDir, "receipt.json"), receiptBytes);
  const plan = {
    version: 1,
    runId: run.runId,
    status,
    violations: finalViolations,
    failClosedReason: failClosedReason || null,
    receipt: {
      filename: `${run.runId}.json`,
      sha256: sha256Bytes(receiptBytes),
      stagedFile: "receipt.json",
    },
    outputs: plannedOutputs,
    finalizedAt,
  };
  await atomicWriteBytes(path.join(run.integrityDir, PLAN_FILENAME), canonicalJsonBytes(plan));
  return plan;
}

function validatePlan(plan, runId) {
  if (!sameKeys(plan, ["version", "runId", "status", "violations", "failClosedReason", "receipt", "outputs", "finalizedAt"])
      || plan.version !== 1 || plan.runId !== runId
      || !["clean", "violated", "fail_closed", "developer_qa"].includes(plan.status)
      || !Array.isArray(plan.violations) || !Array.isArray(plan.outputs)
      || !sameKeys(plan.receipt, ["filename", "sha256", "stagedFile"])
      || !SHA256_PATTERN.test(plan.receipt.sha256 || "") || plan.receipt.stagedFile !== "receipt.json") {
    throw new CompetitionFinalizationError("invalid_finalization_plan", "finalization-plan.json es invalido.");
  }
  const names = new Set();
  for (const output of plan.outputs) {
    if (!sameKeys(output, ["kind", "candidateId", "filename", "sha256", "destination", "stagedFile"])
        || !["event", "note"].includes(output.kind) || !isBoundedString(output.candidateId, 192)
        || path.basename(output.filename) !== output.filename || !SHA256_PATTERN.test(output.sha256 || "")
        || !["pending", "rejected", "rejected_note", "developer_qa"].includes(output.destination)
        || !/^output-[0-9]{3}\.(bin|note)$/.test(output.stagedFile) || names.has(`${output.destination}/${output.filename}`)) {
      throw new CompetitionFinalizationError("invalid_finalization_output", "El plan contiene un output invalido o duplicado.");
    }
    names.add(`${output.destination}/${output.filename}`);
  }
  return plan;
}

async function readPlan(run) {
  const plan = validatePlan(await readSmallJson(path.join(run.integrityDir, PLAN_FILENAME), 512 * 1024), run.runId);
  const stagingDir = path.join(run.integrityDir, FINALIZATION_STAGING_DIR);
  for (const descriptor of [plan.receipt, ...plan.outputs]) {
    const bytes = await readSmallFile(path.join(stagingDir, descriptor.stagedFile), MAX_CANDIDATE_BYTES * 4);
    if (sha256Bytes(bytes) !== descriptor.sha256) {
      throw new CompetitionFinalizationError("staged_output_changed", `Staging alterado: ${descriptor.stagedFile}`);
    }
  }
  return plan;
}

async function readExistingFinalization(run, scope) {
  const commitPath = path.join(run.integrityDir, COMMIT_FILENAME);
  let commit;
  try { commit = await readSmallJson(commitPath, 512 * 1024); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  if (!sameKeys(commit, ["version", "runId", "status", "planSha256", "receiptSha256", "outputs", "finalizedAt", "committedAt"])
      || commit.version !== 1 || commit.runId !== run.runId || !SHA256_PATTERN.test(commit.planSha256 || "")
      || !SHA256_PATTERN.test(commit.receiptSha256 || "") || !Array.isArray(commit.outputs)) {
    throw new CompetitionFinalizationError("invalid_finalization_record", "finalization.json es invalido.");
  }
  const planBytes = await readSmallFile(path.join(run.integrityDir, PLAN_FILENAME), 512 * 1024);
  if (sha256Bytes(planBytes) !== commit.planSha256) throw new CompetitionFinalizationError("finalization_plan_changed", "El plan cambio tras el commit.");
  const plan = validatePlan(JSON.parse(planBytes.toString("utf8")), run.runId);
  const receiptPath = receiptPathFor(scope, run.runId);
  const receiptBytes = await readSmallFile(receiptPath, MAX_CANDIDATE_BYTES * 4);
  if (sha256Bytes(receiptBytes) !== commit.receiptSha256 || commit.receiptSha256 !== plan.receipt.sha256) {
    throw new CompetitionFinalizationError("finalized_receipt_changed", "El finalized-run receipt no coincide con el commit.");
  }
  for (const output of plan.outputs) {
    const bytes = await readSmallFile(outputDestination(scope, output.destination, output.filename), MAX_CANDIDATE_BYTES * 4);
    if (sha256Bytes(bytes) !== output.sha256) throw new CompetitionFinalizationError("finalized_output_changed", `Output alterado: ${output.filename}`);
  }
  return resultFromCommit(commit, plan, scope, true);
}

function resultFromCommit(commit, plan, scope, alreadyFinalized = false) {
  const adopted = [];
  const rejected = [];
  const qa = [];
  for (const output of plan.outputs.filter((item) => item.kind === "event")) {
    const finalPath = outputDestination(scope, output.destination, output.filename);
    const value = { candidateId: output.candidateId, filename: output.filename, finalPath, sha256: output.sha256 };
    if (output.destination === "pending") adopted.push({ ...value, restoredFilename: output.filename });
    else if (output.destination === "developer_qa") qa.push(value);
    else rejected.push({ ...value, notePath: outputDestination(scope, "rejected_note", `${output.filename}.rejected.txt`) });
  }
  return {
    version: 1,
    runId: commit.runId,
    status: commit.status,
    violations: plan.violations,
    failClosedReason: plan.failClosedReason,
    candidateCount: plan.outputs.filter((item) => item.kind === "event").length,
    adopted,
    rejected,
    qa,
    finalizedAt: commit.finalizedAt,
    committedAt: commit.committedAt,
    alreadyFinalized,
  };
}

async function publishPlan(run, scope, plan, options = {}) {
  const stagingDir = path.join(run.integrityDir, FINALIZATION_STAGING_DIR);
  const receiptBytes = await readSmallFile(path.join(stagingDir, plan.receipt.stagedFile), MAX_CANDIDATE_BYTES * 4);
  await atomicWriteBytes(receiptPathFor(scope, run.runId), receiptBytes, options);
  options.afterReceipt?.(plan.receipt);
  for (const output of plan.outputs) {
    const bytes = await readSmallFile(path.join(stagingDir, output.stagedFile), MAX_CANDIDATE_BYTES * 4);
    await atomicWriteBytes(outputDestination(scope, output.destination, output.filename), bytes, options);
    options.afterOutput?.(output);
  }
  const planBytes = await readSmallFile(path.join(run.integrityDir, PLAN_FILENAME), 512 * 1024);
  const commit = {
    version: 1,
    runId: run.runId,
    status: plan.status,
    planSha256: sha256Bytes(planBytes),
    receiptSha256: plan.receipt.sha256,
    outputs: plan.outputs.map(({ kind, candidateId, filename, sha256, destination }) => ({ kind, candidateId, filename, sha256, destination })),
    finalizedAt: plan.finalizedAt,
    committedAt: options.committedAt || new Date().toISOString(),
  };
  options.beforeCommit?.(commit);
  await atomicWriteBytes(path.join(run.integrityDir, COMMIT_FILENAME), canonicalJsonBytes(commit), options);
  return resultFromCommit(commit, plan, scope, false);
}

async function compactCompetitionRun(run, result, options = {}) {
  if (options.compact === false) return null;
  const heavy = ["pack", "plugins", "cfg", "ctrlr", "ini", "nvram", "inp", "sta", "snap", "diff", "comments", "share", "home"];
  for (const name of heavy) await fsp.rm(path.join(run.runRoot, name), { recursive: true, force: true });
  const audit = {
    version: 1,
    runId: run.runId,
    status: result.status,
    violations: result.violations,
    runInputManifestSha256: run.runInputManifestSha256,
    finalizedAt: result.finalizedAt,
    compactedAt: options.compactedAt || new Date().toISOString(),
    removed: heavy,
  };
  await atomicWriteBytes(path.join(run.integrityDir, "compact-audit.json"), canonicalJsonBytes(audit));
  return audit;
}

async function finalizeCompetitionRun(run, scope, options = {}) {
  if (!run?.runId || !run?.integrityDir || !run?.stagingCandidatesDir || !run?.stagingCommitmentsDir
      || !run?.candidateLedgerPath || !run?.config?.pack || !run?.runInputManifestSha256) {
    throw new CompetitionFinalizationError("invalid_run", "No se recibio una run competitiva v2 preparada.");
  }
  if (!scope?.scopedQueueRoot || !scope?.scopedPendingDir || !scope?.scopedRejectedDir) {
    throw new CompetitionFinalizationError("invalid_scope", "No se recibio una cola scoped completa.");
  }
  const existing = await readExistingFinalization(run, scope);
  if (existing) return existing;
  let plan;
  try {
    plan = await readPlan(run);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!plan) {
    let ledger = { candidates: [], violations: [] };
    let failClosedReason = null;
    try { ledger = await readRunLedger(run, options); }
    catch (error) { failClosedReason = `${error.code || error.name || "integrity_unavailable"}: ${error.message}`; }
    plan = await stageFinalizationPlan(run, ledger, failClosedReason, options);
    options.afterPlan?.(plan);
  }
  const result = await publishPlan(run, scope, plan, options);
  await compactCompetitionRun(run, result, options);
  return result;
}

function isPathInside(childPath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function loadCompetitionRunForRecovery(runRoot, userDataDir) {
  const recovery = await readSmallJson(path.join(runRoot, "integrity", "recovery.json"));
  const prepared = await readSmallJson(path.join(runRoot, PREPARED_MARKER_FILENAME));
  if (recovery.version !== 1 || recovery.runId !== path.basename(runRoot) || prepared.version !== 1
      || prepared.runId !== recovery.runId || !SHA256_PATTERN.test(prepared.runInputManifestSha256 || "")
      || !isPathInside(recovery.scopedQueueRoot, path.join(userDataDir, "players"))) {
    throw new CompetitionFinalizationError("invalid_recovery_record", "La identidad de recovery no es valida.");
  }
  const manifestBytes = await readSmallFile(path.join(runRoot, RUN_INPUT_MANIFEST_FILENAME), 512 * 1024);
  if (sha256Bytes(manifestBytes) !== prepared.runInputManifestSha256) {
    throw new CompetitionFinalizationError("recovery_manifest_changed", "El run-input manifest no coincide con prepared.marker.");
  }
  const eventsRoot = path.join(recovery.scopedQueueRoot, "events");
  return {
    runId: recovery.runId,
    runRoot,
    integrityDir: path.join(runRoot, "integrity"),
    stagingCandidatesDir: path.join(runRoot, "events", "candidates"),
    stagingCommitmentsDir: path.join(runRoot, "events", "commitments"),
    candidateLedgerPath: path.join(runRoot, "integrity", "candidate-set.log"),
    runInputManifestSha256: prepared.runInputManifestSha256,
    weekId: recovery.weekId,
    playerBinding: recovery.playerBinding,
    captureClientVersion: recovery.captureClientVersion,
    automaticCaptureStrategy: recovery.automaticCaptureStrategy,
    provenance: recovery.provenance,
    integrity: {
      version: 2,
      guardVersion: 2,
      runId: recovery.runId,
      packId: recovery.packId,
      manifestSha256: recovery.manifestSha256,
      mameVersion: recovery.mameVersion,
      pluginVersion: recovery.pluginVersion,
      weekId: recovery.weekId,
      playerBinding: recovery.playerBinding,
      captureClientVersion: recovery.captureClientVersion,
      runInputManifestSha256: prepared.runInputManifestSha256,
      dips: recovery.dips,
      provenance: recovery.provenance,
    },
    config: { pack: { rom: recovery.rom, gameId: recovery.gameId } },
    scope: {
      scopedQueueRoot: recovery.scopedQueueRoot,
      scopedPendingDir: path.join(eventsRoot, "pending"),
      scopedRejectedDir: path.join(eventsRoot, "rejected"),
    },
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function writeRecoveryStatus(runRoot, status, reason, options = {}) {
  const value = {
    version: 1,
    runId: path.basename(runRoot),
    status,
    reason,
    classifiedAt: options.nowIso || new Date().toISOString(),
  };
  await atomicWriteBytes(path.join(runRoot, "integrity", RECOVERY_STATUS_FILENAME), canonicalJsonBytes(value));
  return value;
}

async function reconcileCompetitionRuns(config = {}, options = {}) {
  if (!config.userDataDir) throw new CompetitionFinalizationError("invalid_recovery_config", "Falta userDataDir para recovery.");
  const runsRoot = path.join(config.userDataDir, "runtime", "runs");
  let entries;
  try { entries = await fsp.readdir(runsRoot, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const results = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const runRoot = path.join(runsRoot, entry.name);
    try {
      await fsp.access(path.join(runRoot, PREPARED_MARKER_FILENAME));
    } catch {
      let preparing = null;
      try { preparing = await readSmallJson(path.join(runRoot, PREPARING_MARKER_FILENAME)); } catch {}
      if (!preparing || !processIsAlive(preparing.pid)) {
        await fsp.rm(runRoot, { recursive: true, force: true });
        results.push({ runId: entry.name, status: "orphan_preparing_removed" });
      } else results.push({ runId: entry.name, status: "preparing_active" });
      continue;
    }
    try {
      const run = await loadCompetitionRunForRecovery(runRoot, config.userDataDir);
      const hasFinal = await fsp.access(path.join(run.integrityDir, "final.marker")).then(() => true, () => false);
      const hasExit = await fsp.access(path.join(run.integrityDir, MAME_EXIT_FILENAME)).then(() => true, () => false);
      const hasCommit = await fsp.access(path.join(run.integrityDir, COMMIT_FILENAME)).then(() => true, () => false);
      if (!hasCommit && (!hasFinal || !hasExit)) {
        const reason = !hasFinal ? "missing_final_seal" : "missing_mame_exit";
        await writeRecoveryStatus(runRoot, "fail_closed", reason, options);
        results.push({ runId: run.runId, status: "fail_closed", reason });
        continue;
      }
      const result = await finalizeCompetitionRun(run, run.scope, { ...options, compact: options.compact });
      results.push({ runId: run.runId, status: result.status, recovered: !result.alreadyFinalized });
    } catch (error) {
      await writeRecoveryStatus(runRoot, "fail_closed", `${error.code || error.name}: ${error.message}`, options).catch(() => null);
      results.push({ runId: entry.name, status: "fail_closed", reason: error.code || error.name });
    }
  }
  return results;
}

module.exports = {
  COMMIT_FILENAME,
  CompetitionFinalizationError,
  PLAN_FILENAME,
  buildFinalEvent,
  compactCompetitionRun,
  finalizeCompetitionRun,
  loadCompetitionRunForRecovery,
  readExistingFinalization,
  readRunLedger,
  reconcileCompetitionRuns,
  sanitizeMetadata,
  validateCandidate,
};
