const fsp = require("node:fs/promises");
const path = require("node:path");
const { deriveCompetitionPlayerBinding } = require("./competition-player-binding");
const {
  atomicWriteBytes,
  canonicalJsonBytes,
} = require("./run-input-integrity");

const SCOPE_AUTHORITY_FILENAME = "scope-authority.json";
const SCOPE_AUTHORITY_VERSION = 1;
const PROTECTED_COMPETITION_MODE = "protected_v2";
const INVALID_PROTECTED_COMPETITION_MODE = "protected_invalid";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AUTHORITY_FIELDS = Object.freeze([
  "version",
  "mode",
  "playerKey",
  "packKey",
  "packId",
  "weekId",
  "establishedAt",
]);
const RECEIPT_FIELDS = Object.freeze([
  "version", "runId", "weekId", "playerBinding", "packId", "manifestSha256",
  "runInputManifestSha256", "captureClientVersion", "provenance", "status",
  "violations", "outputs", "finalizedAt",
]);

class CompetitionScopeAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CompetitionScopeAuthorityError";
    this.code = code;
  }
}

function exactKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
}

function isBoundedString(value, maximum = 192) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function scopePathIdentity(scope = {}) {
  const scopedQueueRoot = path.resolve(String(scope.scopedQueueRoot || ""));
  const inferredPackKey = path.basename(scopedQueueRoot);
  const packsDirectory = path.dirname(scopedQueueRoot);
  const inferredPlayerKey = path.basename(path.dirname(packsDirectory));
  return {
    packKey: scope.packKey || inferredPackKey,
    playerKey: scope.playerKey || inferredPlayerKey,
  };
}

function authorityPathFor(scope) {
  if (!scope?.scopedQueueRoot) {
    throw new CompetitionScopeAuthorityError("scope_authority_path_missing", "Falta scopedQueueRoot para la autoridad competitiva.");
  }
  return path.join(scope.scopedQueueRoot, "competition", SCOPE_AUTHORITY_FILENAME);
}

function requiresProtectedCompetitionFromPack(config = {}) {
  const pack = config.pack;
  const contract = pack?.contract;
  return (pack?.packVersion === 2 || contract?.version === 2)
    && contract?.mame?.profiles?.competition?.integrity?.version === 1
    && contract?.capture?.automatic?.version === 1
    && isBoundedString(contract.capture.automatic.strategy);
}

function authorityIdentityFromMeta(meta, scope) {
  const pathIdentity = scopePathIdentity(scope);
  return {
    playerKey: meta?.player?.playerKey || pathIdentity.playerKey,
    packKey: meta?.pack?.packKey || pathIdentity.packKey,
    packId: meta?.pack?.packId || null,
    weekId: meta?.pack?.weekId || null,
  };
}

function authorityIdentityFromRun(run, scope) {
  const pathIdentity = scopePathIdentity(scope);
  return {
    playerKey: pathIdentity.playerKey,
    packKey: pathIdentity.packKey,
    packId: run?.integrity?.packId || null,
    weekId: run?.weekId || run?.integrity?.weekId || null,
  };
}

function validateAuthority(value, expected = {}) {
  if (!exactKeys(value, AUTHORITY_FIELDS)
      || value.version !== SCOPE_AUTHORITY_VERSION
      || value.mode !== PROTECTED_COMPETITION_MODE
      || !isBoundedString(value.playerKey, 128)
      || !isBoundedString(value.packKey, 128)
      || !isBoundedString(value.packId)
      || !isBoundedString(value.weekId, 128)
      || typeof value.establishedAt !== "string"
      || Number.isNaN(new Date(value.establishedAt).getTime())) {
    return { ok: false, reason: "invalid-scope-authority" };
  }
  for (const field of ["playerKey", "packKey", "packId", "weekId"]) {
    if (expected[field] && value[field] !== expected[field]) {
      return { ok: false, reason: `scope-authority-${field}-mismatch` };
    }
  }
  return { ok: true, reason: null };
}

async function readScopeAuthority(scope, expected = {}) {
  const filePath = authorityPathFor(scope);
  let bytes;
  try {
    const stat = await fsp.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 32 * 1024) throw new Error("invalid-file");
    bytes = await fsp.readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { authority: null, filePath, reason: "missing", status: "missing" };
    return { authority: null, filePath, reason: "invalid-scope-authority", status: "invalid" };
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
    if (!canonicalJsonBytes(value).equals(bytes)) throw new Error("non-canonical");
  } catch {
    return { authority: null, filePath, reason: "invalid-scope-authority", status: "invalid" };
  }
  const validation = validateAuthority(value, expected);
  return validation.ok
    ? { authority: value, filePath, reason: null, status: "valid" }
    : { authority: null, filePath, reason: validation.reason, status: "invalid" };
}

function establishedAt(options = {}) {
  const input = options.establishedAt || options.nowIso || options.now || new Date();
  return input instanceof Date ? input.toISOString() : new Date(input).toISOString();
}

async function establishProtectedScopeAuthority(scope, identity, options = {}) {
  const value = {
    version: SCOPE_AUTHORITY_VERSION,
    mode: PROTECTED_COMPETITION_MODE,
    playerKey: identity.playerKey,
    packKey: identity.packKey,
    packId: identity.packId,
    weekId: identity.weekId,
    establishedAt: establishedAt(options),
  };
  const validation = validateAuthority(value, identity);
  if (!validation.ok) {
    throw new CompetitionScopeAuthorityError(validation.reason, "No se pudo construir una autoridad Protected valida para el scope.");
  }
  const existing = await readScopeAuthority(scope, identity);
  if (existing.status === "valid") return existing;
  if (existing.status === "invalid") {
    throw new CompetitionScopeAuthorityError(existing.reason, "La autoridad competitiva existente contradice el scope y no se sobrescribira.");
  }
  try {
    await (options.atomicWriteAuthorityImpl || atomicWriteBytes)(existing.filePath, canonicalJsonBytes(value));
  } catch (error) {
    const concurrent = await readScopeAuthority(scope, identity);
    if (concurrent.status === "valid") return concurrent;
    throw error;
  }
  const written = await readScopeAuthority(scope, identity);
  if (written.status !== "valid") {
    throw new CompetitionScopeAuthorityError(written.reason, "No se pudo verificar la autoridad competitiva persistida.");
  }
  return written;
}

function validReceiptOutput(output) {
  return exactKeys(output, ["candidateId", "filename", "sha256", "destination"])
    && isBoundedString(output.candidateId)
    && isBoundedString(output.filename, 255)
    && path.basename(output.filename) === output.filename
    && SHA256_PATTERN.test(output.sha256 || "")
    && ["pending", "rejected", "developer_qa"].includes(output.destination);
}

function validReceiptProvenance(provenance) {
  if (!exactKeys(provenance, ["artifactSha256", "artifactSizeBytes", "competitionManifestSha256", "mode"])
      || !SHA256_PATTERN.test(provenance.competitionManifestSha256 || "")) return false;
  if (provenance.mode === "remote_verified") {
    return SHA256_PATTERN.test(provenance.artifactSha256 || "")
      && Number.isSafeInteger(provenance.artifactSizeBytes)
      && provenance.artifactSizeBytes > 0;
  }
  return provenance.mode === "developer_override"
    && provenance.artifactSha256 === null
    && provenance.artifactSizeBytes === null;
}

function validateBackfillReceipt(value, filename, meta) {
  const expectedBinding = meta?.player?.userId
    ? deriveCompetitionPlayerBinding(meta.player.userId)
    : null;
  return exactKeys(value, RECEIPT_FIELDS)
    && value.version === 1
    && isBoundedString(value.runId)
    && filename === `${value.runId}.json`
    && isBoundedString(meta?.pack?.packId)
    && value.packId === meta?.pack?.packId
    && isBoundedString(value.weekId, 128)
    && value.weekId === meta?.pack?.weekId
    && expectedBinding !== null
    && value.playerBinding === expectedBinding
    && SHA256_PATTERN.test(value.manifestSha256 || "")
    && SHA256_PATTERN.test(value.runInputManifestSha256 || "")
    && isBoundedString(value.captureClientVersion, 64)
    && ["clean", "violated", "fail_closed", "developer_qa"].includes(value.status)
    && Array.isArray(value.violations)
    && value.violations.every((code) => isBoundedString(code, 64))
    && Array.isArray(value.outputs)
    && value.outputs.every(validReceiptOutput)
    && validReceiptProvenance(value.provenance)
    && typeof value.finalizedAt === "string"
    && !Number.isNaN(new Date(value.finalizedAt).getTime());
}

async function hasConclusiveFinalizedReceipt(scope, meta) {
  const finalizedDir = path.join(scope.scopedQueueRoot, "competition", "finalized");
  let entries;
  try {
    entries = await fsp.readdir(finalizedDir, { withFileTypes: true });
  } catch (error) {
    return { conclusive: false, reason: error?.code === "ENOENT" ? "missing-finalized-receipt" : "finalized-unreadable" };
  }
  if (entries.length === 0) return { conclusive: false, reason: "missing-finalized-receipt" };
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      return { conclusive: false, reason: "ambiguous-competition-subtree" };
    }
    try {
      const filePath = path.join(finalizedDir, entry.name);
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 512 * 1024) throw new Error("invalid-file");
      const bytes = await fsp.readFile(filePath);
      const value = JSON.parse(bytes.toString("utf8"));
      if (!canonicalJsonBytes(value).equals(bytes) || !validateBackfillReceipt(value, entry.name, meta)) throw new Error("invalid-receipt");
    } catch {
      return { conclusive: false, reason: "ambiguous-competition-subtree" };
    }
  }
  return { conclusive: true, reason: null };
}

async function competitionSubtreeStatus(scope) {
  const competitionRoot = path.join(scope.scopedQueueRoot, "competition");
  try {
    const stat = await fsp.lstat(competitionRoot);
    return stat.isDirectory() && !stat.isSymbolicLink()
      ? { exists: true, valid: true }
      : { exists: true, valid: false };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, valid: true };
    return { exists: true, valid: false };
  }
}

async function resolveScopeCompetitionAuthority(scope, meta, options = {}) {
  const identity = authorityIdentityFromMeta(meta, scope);
  const current = await readScopeAuthority(scope, identity);
  if (current.status === "valid") {
    return { ...current, competitionMode: PROTECTED_COMPETITION_MODE, migrated: false };
  }
  if (current.status === "invalid") {
    return { ...current, competitionMode: INVALID_PROTECTED_COMPETITION_MODE, migrated: false };
  }
  const subtree = await competitionSubtreeStatus(scope);
  if (!subtree.exists) {
    return { ...current, competitionMode: "legacy", migrated: false };
  }
  if (!subtree.valid) {
    return { ...current, competitionMode: INVALID_PROTECTED_COMPETITION_MODE, reason: "ambiguous-competition-subtree", migrated: false };
  }
  const backfill = await hasConclusiveFinalizedReceipt(scope, meta);
  if (!backfill.conclusive) {
    return { ...current, competitionMode: INVALID_PROTECTED_COMPETITION_MODE, reason: backfill.reason, migrated: false };
  }
  try {
    const migrated = await establishProtectedScopeAuthority(scope, identity, options);
    return { ...migrated, competitionMode: PROTECTED_COMPETITION_MODE, migrated: true };
  } catch (error) {
    return {
      authority: null,
      filePath: current.filePath,
      status: "invalid",
      competitionMode: INVALID_PROTECTED_COMPETITION_MODE,
      reason: error.code || "scope-authority-migration-failed",
      migrated: false,
    };
  }
}

async function ensureScopeCompetitionAuthority(config, scope, meta, options = {}) {
  const identity = authorityIdentityFromMeta(meta, scope);
  const current = await readScopeAuthority(scope, identity);
  if (current.status === "invalid") {
    throw new CompetitionScopeAuthorityError(current.reason, "La autoridad competitiva del scope es invalida.");
  }
  if (current.status === "valid") {
    return { ...current, competitionMode: PROTECTED_COMPETITION_MODE, migrated: false };
  }
  if (requiresProtectedCompetitionFromPack(config)) {
    const created = await establishProtectedScopeAuthority(scope, identity, options);
    return { ...created, competitionMode: PROTECTED_COMPETITION_MODE, migrated: false };
  }
  const resolved = await resolveScopeCompetitionAuthority(scope, meta, options);
  if (resolved.competitionMode === INVALID_PROTECTED_COMPETITION_MODE) {
    throw new CompetitionScopeAuthorityError(resolved.reason, "El subtree competitivo no puede degradarse a legacy.");
  }
  return resolved;
}

async function assertProtectedScopeAuthority(run, scope) {
  const expected = authorityIdentityFromRun(run, scope);
  const result = await readScopeAuthority(scope, expected);
  if (result.status !== "valid") {
    throw new CompetitionScopeAuthorityError(
      result.reason === "missing" ? "missing_scope_authority" : result.reason,
      "La finalizacion Protected requiere una autoridad durable del scope valida.",
    );
  }
  return result.authority;
}

module.exports = {
  CompetitionScopeAuthorityError,
  INVALID_PROTECTED_COMPETITION_MODE,
  PROTECTED_COMPETITION_MODE,
  SCOPE_AUTHORITY_FILENAME,
  assertProtectedScopeAuthority,
  authorityPathFor,
  ensureScopeCompetitionAuthority,
  establishProtectedScopeAuthority,
  readScopeAuthority,
  requiresProtectedCompetitionFromPack,
  resolveScopeCompetitionAuthority,
  validateAuthority,
};
