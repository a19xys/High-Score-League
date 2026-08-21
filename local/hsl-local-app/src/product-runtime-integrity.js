const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const PRODUCT_RUNTIME_INTEGRITY_FILENAME = "hsl-runtime-integrity.json";
const PRODUCT_PLUGIN_INTEGRITY_FILENAME = "hsl-plugin-integrity.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_RUNTIME_FILES = Object.freeze([
  "bgfx/chains/crt-geom.json",
  "mame.exe",
  "plugins/boot.lua",
]);
const REQUIRED_PLUGIN_FILES = Object.freeze([
  "core/competition_integrity.lua",
  "core/config.lua",
  "core/json.lua",
  "core/mame_helpers.lua",
  "core/menu.lua",
  "core/paths.lua",
  "core/tracking.lua",
  "core/writer.lua",
  "games/invaders.lua",
  "init.lua",
  "plugin.json",
]);

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateCriticalFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 256) throw new Error("files de integridad de producto es invalido.");
  let previous = null;
  for (const entry of files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "path,sha256,sizeBytes") {
      throw new Error("Entrada de integridad de producto invalida.");
    }
    if (typeof entry.path !== "string" || !entry.path || entry.path.includes("\\") || path.isAbsolute(entry.path) || entry.path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("Path de integridad de producto invalido.");
    }
    if (previous !== null && previous >= entry.path) throw new Error("Files de integridad de producto no estan en orden canonico.");
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || !SHA256_PATTERN.test(entry.sha256 || "")) {
      throw new Error("Size/hash de integridad de producto invalido.");
    }
    previous = entry.path;
  }
}

async function buildCriticalFiles(rootDir, relativePaths) {
  const files = [];
  for (const relativePath of [...relativePaths].sort()) {
    const normalized = relativePath.replace(/\\/g, "/");
    const filePath = path.join(rootDir, ...normalized.split("/"));
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Recurso critico no regular: ${normalized}.`);
    files.push({ path: normalized, sha256: await sha256File(filePath), sizeBytes: stat.size });
  }
  return files;
}

async function writeRuntimeIntegrityManifest(runtimeRoot, mameVersion) {
  const manifest = {
    version: 1,
    mameVersion,
    files: await buildCriticalFiles(runtimeRoot, REQUIRED_RUNTIME_FILES),
  };
  const manifestPath = path.join(runtimeRoot, PRODUCT_RUNTIME_INTEGRITY_FILENAME);
  await fsp.writeFile(manifestPath, canonicalBytes(manifest));
  return { manifest, manifestPath };
}

async function writePluginIntegrityManifest(pluginRoot, pluginVersion, relativePaths) {
  const manifest = {
    version: 1,
    pluginVersion,
    files: await buildCriticalFiles(pluginRoot, relativePaths),
  };
  const manifestPath = path.join(pluginRoot, PRODUCT_PLUGIN_INTEGRITY_FILENAME);
  await fsp.writeFile(manifestPath, canonicalBytes(manifest));
  return { manifest, manifestPath };
}

async function readAndVerifyManifest(rootDir, filename, identityField, expectedIdentity) {
  const manifestPath = path.join(rootDir, filename);
  const bytes = await fsp.readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      Object.keys(manifest).sort().join(",") !== `files,${identityField},version`) {
    throw new Error("Manifest de integridad de producto invalido.");
  }
  if (manifest.version !== 1 || manifest[identityField] !== expectedIdentity) {
    throw new Error("Identidad del manifest de integridad de producto no coincide.");
  }
  validateCriticalFiles(manifest.files);
  if (!canonicalBytes(manifest).equals(bytes)) throw new Error("Manifest de integridad de producto no es canonico.");
  for (const entry of manifest.files) {
    const filePath = path.join(rootDir, ...entry.path.split("/"));
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== entry.sizeBytes || await sha256File(filePath) !== entry.sha256) {
      throw new Error(`Recurso critico de producto modificado: ${entry.path}.`);
    }
  }
  return { manifest, manifestPath };
}

function readPluginVersion(pluginRoot) {
  const parsed = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  const version = parsed?.plugin?.version;
  if (typeof version !== "string" || !version) throw new Error("plugin.json no declara plugin.version.");
  return version;
}

function requireManifestCoverage(verified, requiredPaths) {
  const declared = new Set(verified.manifest.files.map((entry) => entry.path));
  for (const requiredPath of requiredPaths) {
    if (!declared.has(requiredPath)) throw new Error(`Manifest de integridad de producto omite un recurso critico: ${requiredPath}.`);
  }
  return verified;
}

async function verifyBundledMameRuntimeIntegrity(runtimeRoot, mameVersion) {
  return requireManifestCoverage(
    await readAndVerifyManifest(runtimeRoot, PRODUCT_RUNTIME_INTEGRITY_FILENAME, "mameVersion", mameVersion),
    REQUIRED_RUNTIME_FILES,
  );
}

async function verifyBundledPluginIntegrity(pluginRoot) {
  return requireManifestCoverage(
    await readAndVerifyManifest(pluginRoot, PRODUCT_PLUGIN_INTEGRITY_FILENAME, "pluginVersion", readPluginVersion(pluginRoot)),
    REQUIRED_PLUGIN_FILES,
  );
}

module.exports = {
  PRODUCT_PLUGIN_INTEGRITY_FILENAME,
  PRODUCT_RUNTIME_INTEGRITY_FILENAME,
  REQUIRED_PLUGIN_FILES,
  REQUIRED_RUNTIME_FILES,
  buildCriticalFiles,
  readPluginVersion,
  sha256File,
  verifyBundledMameRuntimeIntegrity,
  verifyBundledPluginIntegrity,
  writePluginIntegrityManifest,
  writeRuntimeIntegrityManifest,
};
