const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteJson } = require("./secure-session-storage");

const RECEIPT_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function receiptKey(packId) {
  return crypto.createHash("sha256").update(String(packId)).digest("hex");
}

function getPackProvenanceReceiptPath(config, packId) {
  if (!config?.userDataDir) throw new Error("No se pudo resolver userDataDir para provenance local.");
  return path.join(config.userDataDir, "provenance", "packs", `${receiptKey(packId)}.json`);
}

function validatePackProvenanceReceipt(value, expected = {}) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["El receipt de provenance no es un objeto."], receipt: null };
  }
  if (Object.keys(value).sort().join(",") !== "artifactSha256,artifactSizeBytes,competitionManifestSha256,importedAt,packId,version") {
    errors.push("El receipt de provenance contiene campos desconocidos.");
  }
  if (value.version !== RECEIPT_VERSION) errors.push("El receipt de provenance usa una version no soportada.");
  if (typeof value.packId !== "string" || !value.packId || value.packId.length > 128 || /[\u0000-\u001f\u007f]/.test(value.packId)) {
    errors.push("El receipt de provenance tiene packId invalido.");
  }
  if (!SHA256_PATTERN.test(value.artifactSha256 || "")) errors.push("El receipt de provenance tiene artifactSha256 invalido.");
  if (!Number.isSafeInteger(value.artifactSizeBytes) || value.artifactSizeBytes <= 0) errors.push("El receipt de provenance tiene artifactSizeBytes invalido.");
  if (!SHA256_PATTERN.test(value.competitionManifestSha256 || "")) errors.push("El receipt de provenance tiene competitionManifestSha256 invalido.");
  if (typeof value.importedAt !== "string" || Number.isNaN(new Date(value.importedAt).getTime())) errors.push("El receipt de provenance tiene importedAt invalido.");
  for (const field of ["packId", "artifactSha256", "artifactSizeBytes", "competitionManifestSha256"]) {
    if (expected[field] !== undefined && value[field] !== expected[field]) errors.push(`El receipt de provenance no coincide en ${field}.`);
  }
  return {
    errors,
    receipt: errors.length === 0 ? Object.freeze({ ...value }) : null,
  };
}

function readPackProvenanceReceipt(config, packId, expected = {}) {
  let receiptPath;
  try {
    receiptPath = getPackProvenanceReceiptPath(config, packId);
    const parsed = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const validation = validatePackProvenanceReceipt(parsed, { ...expected, packId });
    return {
      errors: validation.errors,
      exists: true,
      ok: validation.errors.length === 0,
      receipt: validation.receipt,
      receiptPath,
    };
  } catch (error) {
    const missing = error?.code === "ENOENT";
    return {
      errors: [missing ? "No existe provenance de importacion remota verificada." : `No se pudo leer provenance local: ${error.message}`],
      exists: !missing,
      ok: false,
      receipt: null,
      receiptPath: receiptPath || null,
    };
  }
}

async function writePackProvenanceReceipt(config, value, options = {}) {
  const validation = validatePackProvenanceReceipt({
    ...value,
    importedAt: value.importedAt || options.importedAt || new Date().toISOString(),
    version: RECEIPT_VERSION,
  });
  if (validation.errors.length > 0) throw new Error(validation.errors.join(" "));
  const receipt = validation.receipt;
  const receiptPath = getPackProvenanceReceiptPath(config, receipt.packId);
  await (options.atomicWriteImpl || atomicWriteJson)(receiptPath, receipt);
  return { receipt, receiptPath };
}

function developerOverrideProvenance(manifestSha256) {
  return Object.freeze({
    artifactSha256: null,
    artifactSizeBytes: null,
    competitionManifestSha256: manifestSha256,
    mode: "developer_override",
  });
}

function remoteVerifiedProvenance(receipt) {
  return Object.freeze({
    artifactSha256: receipt.artifactSha256,
    artifactSizeBytes: receipt.artifactSizeBytes,
    competitionManifestSha256: receipt.competitionManifestSha256,
    mode: "remote_verified",
  });
}

module.exports = {
  RECEIPT_VERSION,
  developerOverrideProvenance,
  getPackProvenanceReceiptPath,
  readPackProvenanceReceipt,
  remoteVerifiedProvenance,
  validatePackProvenanceReceipt,
  writePackProvenanceReceipt,
};
