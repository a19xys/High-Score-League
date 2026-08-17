const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_PATH = path.resolve(__dirname, "..", "mame-runtime-manifest.json");
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function validateMameRuntimeManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El manifest de MAME debe ser un objeto JSON.");
  }
  if (value.schemaVersion !== 1) throw new Error("schemaVersion de MAME debe ser 1.");
  if (!/^0\.\d+$/.test(value.version || "")) throw new Error("version de MAME no es valida.");
  if (value.architecture !== "x64") throw new Error("architecture de MAME debe ser x64.");
  if (!/^mame\d+b_x64\.exe$/i.test(value.asset || "")) throw new Error("asset de MAME no es valido.");
  if (!/^https:\/\/(github\.com\/mamedev\/mame\/releases\/download|[^/]+\.mamedev\.org)\//i.test(value.url || "")) {
    throw new Error("url de MAME debe apuntar a una fuente oficial HTTPS.");
  }
  if (!SHA256_PATTERN.test(value.sha256 || "")) throw new Error("sha256 de MAME no es valido.");
  return Object.freeze({ ...value, sha256: value.sha256.toLowerCase() });
}

function readMameRuntimeManifest(manifestPath = MANIFEST_PATH) {
  try {
    return validateMameRuntimeManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch (error) {
    throw new Error(`Manifest de MAME invalido (${manifestPath}): ${error.message}`);
  }
}

module.exports = {
  MANIFEST_PATH,
  readMameRuntimeManifest,
  validateMameRuntimeManifest,
};
