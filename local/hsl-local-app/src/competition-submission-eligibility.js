const fsp = require("node:fs/promises");
const path = require("node:path");
const { deriveCompetitionPlayerBinding } = require("./competition-player-binding");
const { sha256Bytes } = require("./run-input-integrity");

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function ineligible(code, reason) {
  return { eligible: false, code, reason };
}

function exactKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
}

async function readJsonLimited(filePath, maximum = 512 * 1024) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximum) throw new Error("invalid-file");
  const bytes = await fsp.readFile(filePath);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function expectedPlayerBinding(config) {
  if (typeof config.competitionPlayerBinding === "string") return config.competitionPlayerBinding;
  const userId = config.scopedQueue?.meta?.player?.userId || config.scopedMeta?.player?.userId;
  return userId ? deriveCompetitionPlayerBinding(userId) : null;
}

async function checkProtectedCompetitionEligibility(config, event, sourcePath) {
  const evidence = event?.competitionIntegrity;
  if (evidence === undefined) return { eligible: true, kind: "legacy" };
  if (evidence?.version !== 2 || evidence.guardVersion !== 2) {
    return ineligible("COMPETITION_EVIDENCE_NOT_ELIGIBLE", "Evidence competitiva distinta de v2 no es elegible para envio productivo.");
  }
  if (evidence.provenance?.mode !== "remote_verified") {
    return ineligible("COMPETITION_PROVENANCE_NOT_PRODUCTIVE", "La provenance de la run no es remote_verified.");
  }
  const playerBinding = expectedPlayerBinding(config);
  if (!playerBinding || evidence.playerBinding !== playerBinding) {
    return ineligible("COMPETITION_PLAYER_MISMATCH", "El playerBinding no pertenece a la cuenta de este scope.");
  }
  if (evidence.weekId !== config.defaultWeekId || evidence.weekId !== config.pack?.weekId) {
    return ineligible("COMPETITION_WEEK_MISMATCH", "La semana capturada no coincide con el scope.");
  }
  if (evidence.packId !== config.pack?.packId) {
    return ineligible("COMPETITION_PACK_MISMATCH", "El pack protegido no coincide con el scope.");
  }
  const scopedQueueRoot = config.scopedQueue?.scopedQueueRoot;
  if (!scopedQueueRoot || !config.userDataDir) {
    return ineligible("COMPETITION_SCOPE_UNAVAILABLE", "No se pudo resolver el scope app-owned.");
  }
  const receiptPath = path.join(scopedQueueRoot, "competition", "finalized", `${evidence.runId}.json`);
  let receiptRecord;
  try { receiptRecord = await readJsonLimited(receiptPath); }
  catch { return ineligible("COMPETITION_RECEIPT_MISSING", "No existe un finalized-run receipt valido."); }
  const receipt = receiptRecord.value;
  if (!exactKeys(receipt, [
    "version", "runId", "weekId", "playerBinding", "packId", "manifestSha256",
    "runInputManifestSha256", "captureClientVersion", "provenance", "status",
    "violations", "outputs", "finalizedAt",
  ]) || receipt.version !== 1 || receipt.status !== "clean" || !Array.isArray(receipt.violations)
      || receipt.violations.length !== 0 || !Array.isArray(receipt.outputs)
      || receipt.provenance?.mode !== "remote_verified") {
    return ineligible("COMPETITION_RECEIPT_NOT_CLEAN", "El finalized-run receipt no acredita una run CLEAN productiva.");
  }
  for (const field of [
    "runId", "weekId", "playerBinding", "packId", "manifestSha256",
    "runInputManifestSha256", "captureClientVersion", "provenance",
  ]) {
    const left = field === "provenance" ? JSON.stringify(receipt[field]) : receipt[field];
    const right = field === "provenance" ? JSON.stringify(evidence[field]) : evidence[field];
    if (left !== right) return ineligible("COMPETITION_RECEIPT_BINDING_MISMATCH", `Receipt y evidence no coinciden en ${field}.`);
  }
  const filename = path.basename(sourcePath);
  const eventBytes = await fsp.readFile(sourcePath);
  const eventSha256 = sha256Bytes(eventBytes);
  const output = receipt.outputs.find((item) => item?.filename === filename && item?.candidateId === event.candidateId);
  if (!output || output.destination !== "pending" || output.sha256 !== eventSha256 || !SHA256_PATTERN.test(output.sha256 || "")) {
    return ineligible("COMPETITION_EVENT_HASH_MISMATCH", "Los bytes del evento no coinciden con el receipt CLEAN.");
  }
  const integrityDir = path.join(config.userDataDir, "runtime", "runs", evidence.runId, "integrity");
  let commitRecord;
  let planRecord;
  try {
    commitRecord = await readJsonLimited(path.join(integrityDir, "finalization.json"));
    planRecord = await readJsonLimited(path.join(integrityDir, "finalization-plan.json"));
  } catch {
    return ineligible("COMPETITION_FINALIZATION_COMMIT_MISSING", "No existe el commit local de finalizacion.");
  }
  const commit = commitRecord.value;
  if (commit?.version !== 1 || commit.runId !== evidence.runId || commit.status !== "clean"
      || commit.planSha256 !== sha256Bytes(planRecord.bytes)
      || commit.receiptSha256 !== sha256Bytes(receiptRecord.bytes)
      || !commit.outputs?.some((item) => item.kind === "event" && item.candidateId === event.candidateId
        && item.filename === filename && item.sha256 === eventSha256 && item.destination === "pending")) {
    return ineligible("COMPETITION_FINALIZATION_COMMIT_MISMATCH", "El commit no autoriza estos bytes exactos.");
  }
  return { eligible: true, kind: "protected_v2", receipt, eventSha256 };
}

module.exports = {
  checkProtectedCompetitionEligibility,
  expectedPlayerBinding,
};
