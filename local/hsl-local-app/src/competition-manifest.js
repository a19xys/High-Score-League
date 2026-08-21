const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const COMPETITION_MANIFEST_FILENAME = "competition-manifest.json";
const COMPETITION_MANIFEST_VERSION = 1;
const MAX_MANIFEST_FILES = 4096;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

class CompetitionManifestError extends Error {
  constructor(code, detail) {
    super(`Los archivos competitivos de este pack han cambiado. Puedes seguir practicando. (${detail})`);
    this.name = "CompetitionManifestError";
    this.code = code;
    this.detail = detail;
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function toManifestPath(packRoot, absolutePath) {
  const relative = path.relative(path.resolve(packRoot), path.resolve(absolutePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CompetitionManifestError("unsafe_path", "una ruta competitiva queda fuera del pack");
  }
  const normalized = relative.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..") ||
      normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new CompetitionManifestError("unsafe_path", `ruta no permitida: ${normalized}`);
  }
  return normalized;
}

async function listRegularFiles(root, packRoot) {
  const result = [];
  let entries;
  try {
    const rootStat = await fsp.lstat(root);
    if (rootStat.isSymbolicLink()) throw new CompetitionManifestError("symlink", `symlink no permitido: ${toManifestPath(packRoot, root)}`);
    if (!rootStat.isDirectory()) throw new CompetitionManifestError("special_entry", `se esperaba un directorio: ${toManifestPath(packRoot, root)}`);
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new CompetitionManifestError("missing_critical_file", `falta ${toManifestPath(packRoot, root)}`);
    throw error;
  }

  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    const stat = await fsp.lstat(absolutePath);
    if (stat.isSymbolicLink()) throw new CompetitionManifestError("symlink", `symlink no permitido: ${toManifestPath(packRoot, absolutePath)}`);
    if (stat.isDirectory()) result.push(...await listRegularFiles(absolutePath, packRoot));
    else if (stat.isFile()) result.push(absolutePath);
    else throw new CompetitionManifestError("special_entry", `entrada especial no permitida: ${toManifestPath(packRoot, absolutePath)}`);
  }
  return result;
}

async function assertRegularFile(absolutePath, packRoot) {
  let stat;
  try {
    stat = await fsp.lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new CompetitionManifestError("missing_critical_file", `falta ${toManifestPath(packRoot, absolutePath)}`);
    throw error;
  }
  if (stat.isSymbolicLink()) throw new CompetitionManifestError("symlink", `symlink no permitido: ${toManifestPath(packRoot, absolutePath)}`);
  if (!stat.isFile()) throw new CompetitionManifestError("special_entry", `se esperaba un archivo regular: ${toManifestPath(packRoot, absolutePath)}`);
  return absolutePath;
}

async function listCompetitionRelevantFiles(pack) {
  const packRoot = pack?.packRoot;
  const contract = pack?.contract;
  if (!packRoot || contract?.version !== 2) throw new CompetitionManifestError("invalid_pack", "el pack v2 no tiene una raiz resuelta");

  const files = new Set();
  const addFile = async (absolutePath) => files.add(await assertRegularFile(absolutePath, packRoot));
  await addFile(path.join(packRoot, "pack.json"));
  await addFile(contract.capture?.adapterPath || path.resolve(packRoot, contract.capture?.adapter || ""));

  const romDir = contract.mame?.romDir;
  if (!romDir) throw new CompetitionManifestError("missing_critical_file", "mame.romPath no esta resuelto");
  for (const filename of await listRegularFiles(romDir, packRoot)) files.add(filename);

  // MAME layouts may declare interactive inputtag/inputmask elements. Artwork
  // is therefore competitive input, not merely presentation, when supplied.
  const artworkDir = contract.mame?.artworkDir;
  if (artworkDir) for (const filename of await listRegularFiles(artworkDir, packRoot)) files.add(filename);

  const scriptsDir = path.join(packRoot, "scripts");
  try {
    const stat = await fsp.lstat(scriptsDir);
    if (stat.isSymbolicLink()) throw new CompetitionManifestError("symlink", "scripts es un symlink");
    if (!stat.isDirectory()) throw new CompetitionManifestError("special_entry", "scripts no es un directorio");
    for (const filename of await listRegularFiles(scriptsDir, packRoot)) files.add(filename);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const seedDir = contract.mame?.profiles?.competition?.cfgDir;
  if (seedDir) for (const filename of await listRegularFiles(seedDir, packRoot)) files.add(filename);

  const ordered = [...files].map((absolutePath) => ({ absolutePath, path: toManifestPath(packRoot, absolutePath) }));
  ordered.sort((left, right) => compareText(left.path, right.path));
  if (ordered.length === 0 || ordered.length > MAX_MANIFEST_FILES) {
    throw new CompetitionManifestError("file_count", `numero de archivos fuera de limite: ${ordered.length}`);
  }
  return ordered;
}

function canonicalManifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function buildCompetitionManifest(pack) {
  const files = [];
  for (const entry of await listCompetitionRelevantFiles(pack)) {
    const bytes = await fsp.readFile(entry.absolutePath);
    files.push({ path: entry.path, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = { version: COMPETITION_MANIFEST_VERSION, packId: pack.packId, files };
  const bytes = canonicalManifestBytes(manifest);
  return { bytes, manifest, manifestSha256: sha256(bytes) };
}

function validateManifestShape(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CompetitionManifestError("invalid_manifest", "manifest no es un objeto");
  if (Object.keys(parsed).sort().join(",") !== "files,packId,version") throw new CompetitionManifestError("invalid_manifest", "campos de manifest desconocidos");
  if (parsed.version !== COMPETITION_MANIFEST_VERSION) throw new CompetitionManifestError("invalid_manifest", "version de manifest desconocida");
  if (typeof parsed.packId !== "string" || !parsed.packId.trim() || parsed.packId.length > 128 || /[\u0000-\u001f\u007f]/.test(parsed.packId)) {
    throw new CompetitionManifestError("invalid_manifest", "packId de manifest invalido");
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0 || parsed.files.length > MAX_MANIFEST_FILES) {
    throw new CompetitionManifestError("invalid_manifest", "files de manifest invalido");
  }
  const seen = new Set();
  let previous = null;
  for (const entry of parsed.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "path,sha256,sizeBytes") {
      throw new CompetitionManifestError("invalid_manifest", "entrada de manifest invalida");
    }
    if (typeof entry.path !== "string" || entry.path.length === 0 || entry.path.length > 512 || entry.path.includes("\\") || path.isAbsolute(entry.path) ||
        entry.path.split("/").some((part) => !part || part === "." || part === "..") || /[\u0000-\u001f\u007f]/.test(entry.path)) {
      throw new CompetitionManifestError("invalid_manifest", "path de manifest invalido");
    }
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new CompetitionManifestError("invalid_manifest", `size/hash invalido para ${entry.path}`);
    }
    if (entry.path === COMPETITION_MANIFEST_FILENAME || seen.has(entry.path) || (previous !== null && compareText(previous, entry.path) >= 0)) {
      throw new CompetitionManifestError("invalid_manifest", `path duplicado o desordenado: ${entry.path}`);
    }
    seen.add(entry.path);
    previous = entry.path;
  }
}

async function verifyCompetitionManifest(pack) {
  const manifestPath = path.join(pack.packRoot, COMPETITION_MANIFEST_FILENAME);
  let bytes;
  try { bytes = await fsp.readFile(manifestPath); }
  catch (error) {
    if (error?.code === "ENOENT") throw new CompetitionManifestError("missing_manifest", `falta ${COMPETITION_MANIFEST_FILENAME}`);
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new CompetitionManifestError("invalid_manifest", `JSON invalido: ${error.message}`); }
  validateManifestShape(parsed);
  if (parsed.packId !== pack.packId) throw new CompetitionManifestError("pack_id_mismatch", "packId no coincide");
  if (!canonicalManifestBytes(parsed).equals(bytes)) throw new CompetitionManifestError("noncanonical_manifest", "los bytes del manifest no son canonicos");

  const relevant = await listCompetitionRelevantFiles(pack);
  const expectedPaths = relevant.map((entry) => entry.path);
  const declaredPaths = parsed.files.map((entry) => entry.path);
  if (JSON.stringify(expectedPaths) !== JSON.stringify(declaredPaths)) {
    throw new CompetitionManifestError("coverage_mismatch", "faltan o sobran archivos competitivos en el manifest");
  }
  for (let index = 0; index < relevant.length; index += 1) {
    const entry = parsed.files[index];
    const fileBytes = await fsp.readFile(relevant[index].absolutePath);
    if (fileBytes.length !== entry.sizeBytes) throw new CompetitionManifestError("size_mismatch", `tamano distinto: ${entry.path}`);
    if (sha256(fileBytes) !== entry.sha256) throw new CompetitionManifestError("hash_mismatch", `hash distinto: ${entry.path}`);
  }
  return { manifest: parsed, manifestPath, manifestSha256: sha256(bytes) };
}

async function writeCompetitionManifest(pack, outputPath = path.join(pack.packRoot, COMPETITION_MANIFEST_FILENAME)) {
  const built = await buildCompetitionManifest(pack);
  await fsp.writeFile(outputPath, built.bytes);
  return { ...built, manifestPath: outputPath };
}

module.exports = {
  COMPETITION_MANIFEST_FILENAME,
  COMPETITION_MANIFEST_VERSION,
  CompetitionManifestError,
  buildCompetitionManifest,
  canonicalManifestBytes,
  listCompetitionRelevantFiles,
  sha256,
  validateManifestShape,
  verifyCompetitionManifest,
  writeCompetitionManifest,
};
