const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");
const { getDirectoryKey, readPackDirectory } = require("./pack-directory");
const { loadPackFromDir } = require("./pack");
const { isUnsafePackRelativePath } = require("./pack-contract");

const IMPORT_TEMP_PREFIX = ".hsl-import-";
const DEFAULT_IMPORT_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxFileSize: 1024 * 1024 * 1024,
  maxTotalSize: 4 * 1024 * 1024 * 1024,
});

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

class PackImportError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "PackImportError";
    this.code = code;
    this.details = details;
  }
}

function importError(code, message, details = []) {
  return new PackImportError(code, message, details);
}

function isInside(parentDir, childPath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeZipEntryName(rawName) {
  if (typeof rawName !== "string") {
    throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.");
  }

  if (rawName.includes("\0")) {
    throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", ["Ruta con byte nulo."]);
  }

  if (rawName.trim() === "") {
    throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", ["Ruta vacia."]);
  }

  if (/^[a-zA-Z]:[\\/]/.test(rawName) || /^[\\/]{2}/.test(rawName) || /^[\\/]/.test(rawName)) {
    throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Ruta absoluta: ${rawName}`]);
  }

  const normalizedSeparators = rawName.replace(/\\/g, "/");

  if (/^[a-zA-Z]:\//.test(normalizedSeparators) || normalizedSeparators.startsWith("/") || normalizedSeparators.startsWith("//")) {
    throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Ruta absoluta: ${rawName}`]);
  }

  const withoutTrailingSlash = normalizedSeparators.replace(/\/+$/u, "");
  const normalized = path.posix.normalize(withoutTrailingSlash);

  if (normalized === "." || normalized === "" || normalized.startsWith("../") || normalized === "..") {
    throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Ruta invalida: ${rawName}`]);
  }

  const segments = normalized.split("/");

  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Segmento inseguro: ${rawName}`]);
    }

    if (/[<>:"|?*\x00-\x1f]/u.test(segment)) {
      throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Nombre no valido en Windows: ${segment}`]);
    }

    if (/[. ]$/u.test(segment)) {
      throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Nombre con punto o espacio final: ${segment}`]);
    }

    const deviceName = segment.split(".")[0].toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(deviceName)) {
      throw importError("unsafe_zip_path", "El ZIP contiene rutas inseguras.", [`Nombre reservado de Windows: ${segment}`]);
    }
  }

  return normalized;
}

function isKnownTrash(normalizedPath) {
  const lower = normalizedPath.toLowerCase();
  return lower === ".ds_store" ||
    lower.endsWith("/.ds_store") ||
    lower === "thumbs.db" ||
    lower.endsWith("/thumbs.db") ||
    lower === "__macosx" ||
    lower.startsWith("__macosx/");
}

function zipEntryKind(entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0o177777;
  const type = mode & 0o170000;

  if (entry.fileName.endsWith("/")) {
    return "directory";
  }

  if (!type) {
    return "file";
  }

  if (type === 0o040000) {
    return "directory";
  }

  if (type === 0o100000) {
    return "file";
  }

  if (type === 0o120000) {
    return "symlink";
  }

  return "special";
}

function validateZipEntry(entry, limits) {
  const normalizedPath = normalizeZipEntryName(entry.fileName);
  const ignored = isKnownTrash(normalizedPath);
  const kind = zipEntryKind(entry);

  if (kind === "symlink" || kind === "special") {
    throw importError("unsafe_zip_entry", "El ZIP contiene entradas especiales no permitidas.");
  }

  if (!ignored && kind === "file") {
    if (entry.uncompressedSize > limits.maxFileSize) {
      throw importError("zip_too_large", "El ZIP supera los limites de tamano permitidos.");
    }
  }

  return {
    compressedSize: entry.compressedSize || 0,
    directory: kind === "directory",
    ignored,
    normalizedPath,
    rawName: entry.fileName,
    uncompressedSize: entry.uncompressedSize || 0,
  };
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, {
      lazyEntries: true,
      validateEntrySizes: true,
    }, (error, zipfile) => {
      if (error) {
        reject(importError("corrupt_zip", "No se pudo leer el ZIP. Puede estar corrupto.", [error.message]));
        return;
      }

      resolve(zipfile);
    });
  });
}

async function readZipEntries(zipPath, options = {}) {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...(options.limits || {}) };
  const zipfile = await openZip(zipPath);
  const entries = [];
  let totalSize = 0;

  return new Promise((resolve, reject) => {
    let settled = false;

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      zipfile.close();
      reject(error);
    }

    zipfile.on("entry", (entry) => {
      try {
        if (entries.length + 1 > limits.maxEntries) {
          throw importError("zip_too_large", "El ZIP tiene demasiados archivos para importar.");
        }

        const normalized = validateZipEntry(entry, limits);
        entries.push(normalized);

        if (!normalized.ignored && !normalized.directory) {
          totalSize += normalized.uncompressedSize;
          if (totalSize > limits.maxTotalSize) {
            throw importError("zip_too_large", "El ZIP supera los limites de tamano permitidos.");
          }
        }

        zipfile.readEntry();
      } catch (error) {
        fail(error);
      }
    });

    zipfile.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      zipfile.close();
      resolve({
        entries,
        limits,
        totalSize,
      });
    });

    zipfile.on("error", (error) => {
      fail(importError("corrupt_zip", "No se pudo leer el ZIP. Puede estar corrupto.", [error.message]));
    });

    zipfile.readEntry();
  });
}

function detectPackRootInZip(entries) {
  const usefulEntries = entries.filter((entry) => !entry.ignored);
  const packJsonPaths = usefulEntries
    .filter((entry) => !entry.directory && entry.normalizedPath.toLowerCase().endsWith("pack.json"))
    .map((entry) => entry.normalizedPath);

  if (packJsonPaths.length === 0) {
    throw importError("missing_pack_json", "No encuentro pack.json.");
  }

  const tooDeep = packJsonPaths.find((entryPath) => entryPath.split("/").length > 2);
  if (tooDeep) {
    throw importError("pack_json_too_deep", "No se admite pack.json tan profundo en este MVP.");
  }

  if (packJsonPaths.length > 1) {
    throw importError("multiple_packs", "Este ZIP contiene varios packs. Importa un pack cada vez.");
  }

  const packJsonPath = packJsonPaths[0];
  const segments = packJsonPath.split("/");
  const rootPrefix = segments.length === 1 ? "" : `${segments[0]}/`;

  if (rootPrefix) {
    const outsideRoot = usefulEntries.find((entry) => !entry.normalizedPath.startsWith(rootPrefix));
    if (outsideRoot) {
      throw importError("ambiguous_zip", "Este ZIP tiene archivos fuera de la carpeta del pack.");
    }
  }

  return {
    packJsonPath,
    rootPrefix,
  };
}

function ensureResolvedInside(rootDir, relativePath) {
  const targetPath = path.resolve(rootDir, relativePath);

  if (!isInside(rootDir, targetPath)) {
    throw importError("unsafe_path", "El pack intenta usar rutas fuera de su carpeta.");
  }

  return targetPath;
}

function createByteLimitTransform(limits, entry, counters) {
  let entryBytes = 0;

  return new Transform({
    transform(chunk, _encoding, callback) {
      entryBytes += chunk.length;
      counters.totalBytes += chunk.length;

      if (entryBytes > limits.maxFileSize || counters.totalBytes > limits.maxTotalSize) {
        callback(importError("zip_too_large", "El ZIP supera los limites de tamano permitidos."));
        return;
      }

      callback(null, chunk);
    },
    flush(callback) {
      if (entry.uncompressedSize && entryBytes !== entry.uncompressedSize) {
        callback(importError("corrupt_zip", "No se pudo leer el ZIP. Puede estar corrupto."));
        return;
      }

      callback();
    },
  });
}

function openReadStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(importError("corrupt_zip", "No se pudo leer el ZIP. Puede estar corrupto.", [error.message]));
        return;
      }

      resolve(stream);
    });
  });
}

async function extractZipRootToDirectory(zipPath, destinationDir, rootInfo, options = {}) {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...(options.limits || {}) };
  const zipfile = await openZip(zipPath);
  const counters = { totalBytes: 0 };
  const destinationRoot = path.resolve(destinationDir);

  await fsp.mkdir(destinationRoot, { recursive: true });

  return new Promise((resolve, reject) => {
    let active = Promise.resolve();
    let settled = false;
    let entryCount = 0;

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      zipfile.close();
      reject(error);
    }

    zipfile.on("entry", (entry) => {
      active = active.then(async () => {
        if (settled) {
          return;
        }

        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw importError("zip_too_large", "El ZIP tiene demasiados archivos para importar.");
        }

        const normalized = validateZipEntry(entry, limits);

        if (normalized.ignored || !normalized.normalizedPath.startsWith(rootInfo.rootPrefix)) {
          zipfile.readEntry();
          return;
        }

        const relativePath = rootInfo.rootPrefix
          ? normalized.normalizedPath.slice(rootInfo.rootPrefix.length)
          : normalized.normalizedPath;

        if (!relativePath) {
          zipfile.readEntry();
          return;
        }

        const targetPath = ensureResolvedInside(destinationRoot, relativePath);

        if (normalized.directory) {
          await fsp.mkdir(targetPath, { recursive: true });
          zipfile.readEntry();
          return;
        }

        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        const readStream = await openReadStream(zipfile, entry);
        await pipeline(
          readStream,
          createByteLimitTransform(limits, normalized, counters),
          fs.createWriteStream(targetPath, { flags: "wx" }),
        );
        zipfile.readEntry();
      }).catch(fail);
    });

    zipfile.on("end", () => {
      active.then(() => {
        if (settled) {
          return;
        }
        settled = true;
        zipfile.close();
        resolve();
      }).catch(fail);
    });

    zipfile.on("error", (error) => {
      fail(importError("corrupt_zip", "No se pudo leer el ZIP. Puede estar corrupto.", [error.message]));
    });

    zipfile.readEntry();
  });
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathIsFile(targetPath) {
  try {
    const stat = await fsp.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function detectPackRootInFolder(folderPath) {
  const sourceRoot = path.resolve(folderPath);
  const sourceStat = await fsp.lstat(sourceRoot);

  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw importError("invalid_folder", "La ruta elegida no es una carpeta de pack valida.");
  }

  if (await pathIsFile(path.join(sourceRoot, "pack.json"))) {
    return {
      packDir: sourceRoot,
      mode: "pack-root",
    };
  }

  const entries = await fsp.readdir(sourceRoot, { withFileTypes: true });
  const packDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    const childDir = path.join(sourceRoot, entry.name);
    if (await pathIsFile(path.join(childDir, "pack.json"))) {
      packDirs.push(childDir);
    }
  }

  if (packDirs.length === 0) {
    throw importError("missing_pack_json", "No encuentro pack.json.");
  }

  if (packDirs.length > 1) {
    throw importError("multiple_packs", "Esta carpeta contiene varios packs. Importa un pack cada vez.");
  }

  return {
    packDir: packDirs[0],
    mode: "single-child-pack",
  };
}

async function copyFolderContentsSafe(sourceDir, destinationDir) {
  const sourceRoot = path.resolve(sourceDir);
  const destinationRoot = path.resolve(destinationDir);

  async function copyEntry(sourcePath, relativePath) {
    const stat = await fsp.lstat(sourcePath);

    if (stat.isSymbolicLink()) {
      throw importError("unsafe_folder_entry", "La carpeta contiene enlaces no permitidos.");
    }

    const targetPath = ensureResolvedInside(destinationRoot, relativePath);

    if (stat.isDirectory()) {
      await fsp.mkdir(targetPath, { recursive: true });
      const entries = await fsp.readdir(sourcePath);

      for (const name of entries) {
        if (name.includes("\0")) {
          throw importError("unsafe_folder_entry", "La carpeta contiene rutas inseguras.");
        }

        await copyEntry(path.join(sourcePath, name), path.join(relativePath, name));
      }
      return;
    }

    if (!stat.isFile()) {
      throw importError("unsafe_folder_entry", "La carpeta contiene entradas especiales no permitidas.");
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }

  if (!isInside(sourceRoot, sourceRoot)) {
    throw importError("unsafe_folder_entry", "La carpeta contiene rutas inseguras.");
  }

  await fsp.mkdir(destinationRoot, { recursive: true });
  const entries = await fsp.readdir(sourceRoot);

  for (const name of entries) {
    await copyEntry(path.join(sourceRoot, name), name);
  }
}

function normalizeTechnicalError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readRequiredJson(filePath, code, message) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw importError("missing_pack_json", "No encuentro pack.json.");
    }

    throw importError(code, message, [normalizeTechnicalError(error)]);
  }
}

function relativeDisplayPath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/");
}

async function validateTemporaryPackInstall(packDir) {
  await readRequiredJson(
    path.join(packDir, "pack.json"),
    "invalid_pack_json",
    "pack.json no es JSON valido.",
  );

  if (await pathExists(path.join(packDir, "metadata.json"))) {
    await readRequiredJson(
      path.join(packDir, "metadata.json"),
      "invalid_metadata_json",
      "metadata.json no es JSON valido.",
    );
  }

  let result;

  try {
    result = loadPackFromDir(packDir);
  } catch (error) {
    throw importError("invalid_pack", "El pack no parece valido para High Score League.", [normalizeTechnicalError(error)]);
  }

  if (!result.loaded) {
    throw importError("missing_pack_json", "No encuentro pack.json.");
  }

  const pack = result.pack;

  if (pack?.packVersion !== 2) {
    throw importError("unsupported_pack_version", "Este pack no es compatible con esta version del launcher.");
  }

  if (result.errors.length > 0) {
    throw importError("invalid_pack", "El pack no parece valido para High Score League.", result.errors);
  }

  const romPath = pack?.contract?.mame?.romPath;
  const romDir = pack?.contract?.mame?.romDir;
  const rom = pack?.rom;

  if (!romDir || !rom) {
    throw importError("invalid_pack", "El pack no parece valido para High Score League.");
  }

  const romFile = path.join(romDir, `${rom}.zip`);
  if (!(await pathIsFile(romFile))) {
    const displayPath = `${relativeDisplayPath(romPath || "roms").replace(/\/+$/u, "")}/${rom}.zip`;
    throw importError("missing_rom", `Falta la ROM necesaria: ${displayPath}.`);
  }

  const adapterPath = pack?.contract?.capture?.adapterPath;
  const adapter = pack?.contract?.capture?.adapter;

  if (!adapterPath || !(await pathIsFile(adapterPath))) {
    throw importError("missing_adapter", `Falta el adaptador de captura: ${relativeDisplayPath(adapter || "capture.adapter")}.`);
  }

  const metadata = pack.metadata || {};
  const manualCandidates = [
    metadata.manualPath,
    typeof metadata.manual === "string" ? metadata.manual : metadata.manual?.path,
  ].filter(Boolean);

  for (const manualPath of manualCandidates) {
    if (isUnsafePackRelativePath(manualPath)) {
      throw importError("unsafe_manual_path", "El pack intenta usar rutas fuera de su carpeta.");
    }
  }

  return {
    pack,
    warnings: pack.warnings || result.warnings || [],
  };
}

function cleanFolderName(value) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "")
    .slice(0, 80)
    .trim()
    .replace(/[. ]+$/u, "");

  if (!cleaned) {
    return null;
  }

  const deviceName = cleaned.split(".")[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(deviceName)) {
    return null;
  }

  return cleaned;
}

function createSafeInstallFolderName(pack, metadata = {}, sourcePath = null) {
  const candidates = [
    metadata.title,
    pack?.metadata?.title,
    pack?.packId,
    pack?.gameId,
    sourcePath ? path.basename(sourcePath).replace(/\.hslpack\.zip$/i, "").replace(/\.zip$/i, "") : null,
  ];

  for (const candidate of candidates) {
    const cleaned = cleanFolderName(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  return `pack-${crypto.randomBytes(4).toString("hex")}`;
}

async function createTemporaryInstallDir(packDirectoryPath) {
  const name = `${IMPORT_TEMP_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const tempDir = path.join(packDirectoryPath, name);
  await fsp.mkdir(tempDir, { recursive: false });
  return tempDir;
}

async function resolveConfiguredPackDirectory(config) {
  const directory = await readPackDirectory(config);

  if (!directory.directoryPath) {
    throw importError("pack_directory_unconfigured", "Elige primero un directorio de packs.");
  }

  if (!directory.exists || directory.looksLikePackRoot) {
    throw importError("pack_directory_unavailable", "No se puede importar hasta elegir un directorio de packs valido.");
  }

  return path.resolve(directory.directoryPath);
}

function isDirectChildOf(parentDir, childDir) {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childDir);
  return path.dirname(child) === parent;
}

async function findInstalledPackById(packDirectoryPath, packId, options = {}) {
  if (!packId) {
    return null;
  }

  const excludeKey = options.excludeDir ? getDirectoryKey(options.excludeDir) : null;
  const targetPackId = String(packId).trim().toLowerCase();
  const entries = await fsp.readdir(packDirectoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(IMPORT_TEMP_PREFIX)) {
      continue;
    }

    const packDir = path.join(packDirectoryPath, entry.name);
    if (excludeKey && getDirectoryKey(packDir) === excludeKey) {
      continue;
    }

    try {
      const result = loadPackFromDir(packDir);
      if (result.loaded && String(result.pack?.packId || "").trim().toLowerCase() === targetPackId) {
        return {
          pack: result.pack,
          packDir,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function finalizeImport(tempDir, packDirectoryPath, pack, sourcePath) {
  const destinationName = createSafeInstallFolderName(pack, pack.metadata || {}, sourcePath);
  const finalPackDir = path.join(packDirectoryPath, destinationName);

  if (await pathExists(finalPackDir)) {
    throw importError("destination_collision", "Ya existe un pack instalado en esa carpeta.");
  }

  const duplicate = await findInstalledPackById(packDirectoryPath, pack.packId);
  if (duplicate) {
    throw importError("duplicate_pack_id", "Ya tienes instalado un pack con el mismo packId.");
  }

  await fsp.rename(tempDir, finalPackDir);

  return {
    finalPackDir,
    installedFolderName: destinationName,
  };
}

async function cleanupFailedImport(tempDir) {
  if (tempDir) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function inspectImportSource(sourcePath, config, options = {}) {
  const resolvedSource = path.resolve(sourcePath);
  const stat = await fsp.stat(resolvedSource);
  const packDirectoryPath = await resolveConfiguredPackDirectory(config);

  if (stat.isDirectory()) {
    const folderRoot = await detectPackRootInFolder(resolvedSource);
    return {
      kind: "folder",
      packDirectoryPath,
      sourcePath: resolvedSource,
      ...folderRoot,
    };
  }

  if (stat.isFile()) {
    const zip = await readZipEntries(resolvedSource, options);
    return {
      kind: "zip",
      packDirectoryPath,
      sourcePath: resolvedSource,
      zip,
      zipRoot: detectPackRootInZip(zip.entries),
    };
  }

  throw importError("invalid_source", "La ruta elegida no es un ZIP ni una carpeta de pack valida.");
}

async function importPackFromZip(zipPath, config, options = {}) {
  const sourcePath = path.resolve(zipPath);
  const packDirectoryPath = await resolveConfiguredPackDirectory(config);
  const inspection = await readZipEntries(sourcePath, options);
  const zipRoot = detectPackRootInZip(inspection.entries);
  let tempDir = null;

  try {
    tempDir = await createTemporaryInstallDir(packDirectoryPath);
    await extractZipRootToDirectory(sourcePath, tempDir, zipRoot, options);
    const validated = await validateTemporaryPackInstall(tempDir);
    const finalized = await finalizeImport(tempDir, packDirectoryPath, validated.pack, sourcePath);
    tempDir = null;

    return {
      alreadyInstalled: false,
      imported: true,
      kind: "zip",
      limits: inspection.limits,
      ok: true,
      pack: validated.pack,
      packDir: finalized.finalPackDir,
      summary: `Pack importado: ${validated.pack.metadata?.title || validated.pack.packId || validated.pack.gameId}.`,
      warnings: validated.warnings,
      ...finalized,
    };
  } catch (error) {
    await cleanupFailedImport(tempDir);
    throw error;
  }
}

async function importPackFromFolder(folderPath, config, options = {}) {
  const sourcePath = path.resolve(folderPath);
  const packDirectoryPath = await resolveConfiguredPackDirectory(config);
  const detected = await detectPackRootInFolder(sourcePath);
  const sourcePackDir = detected.packDir;
  const alreadyInstalled = isDirectChildOf(packDirectoryPath, sourcePackDir);

  if (alreadyInstalled) {
    const validated = await validateTemporaryPackInstall(sourcePackDir);
    const duplicate = await findInstalledPackById(packDirectoryPath, validated.pack.packId, {
      excludeDir: sourcePackDir,
    });

    if (duplicate) {
      throw importError("duplicate_pack_id", "Ya tienes instalado un pack con el mismo packId.");
    }

    return {
      alreadyInstalled: true,
      imported: false,
      kind: "folder",
      ok: true,
      pack: validated.pack,
      packDir: sourcePackDir,
      summary: "Este pack ya estaba en la biblioteca.",
      warnings: validated.warnings,
    };
  }

  let tempDir = null;

  try {
    tempDir = await createTemporaryInstallDir(packDirectoryPath);
    await copyFolderContentsSafe(sourcePackDir, tempDir);
    const validated = await validateTemporaryPackInstall(tempDir);
    const finalized = await finalizeImport(tempDir, packDirectoryPath, validated.pack, sourcePath);
    tempDir = null;

    return {
      alreadyInstalled: false,
      imported: true,
      kind: "folder",
      ok: true,
      pack: validated.pack,
      packDir: finalized.finalPackDir,
      summary: `Pack importado: ${validated.pack.metadata?.title || validated.pack.packId || validated.pack.gameId}.`,
      warnings: validated.warnings,
      ...finalized,
    };
  } catch (error) {
    await cleanupFailedImport(tempDir);
    throw error;
  }
}

module.exports = {
  DEFAULT_IMPORT_LIMITS,
  IMPORT_TEMP_PREFIX,
  PackImportError,
  cleanupFailedImport,
  copyFolderContentsSafe,
  createSafeInstallFolderName,
  detectPackRootInFolder,
  detectPackRootInZip,
  importPackFromFolder,
  importPackFromZip,
  inspectImportSource,
  normalizeZipEntryName,
  validateTemporaryPackInstall,
};
