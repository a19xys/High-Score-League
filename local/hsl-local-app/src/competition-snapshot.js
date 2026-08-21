const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  COMPETITION_MANIFEST_FILENAME,
  CompetitionManifestError,
  canonicalManifestBytes,
  listCompetitionRelevantFiles,
  sha256,
  validateManifestShape,
  verifyCompetitionManifest,
} = require("./competition-manifest");
const { loadPackFromDir } = require("./pack");

const IDENTITY_FIELDS = Object.freeze(["packId", "gameId", "rom", "weekId", "packVersion"]);

class CompetitionSnapshotError extends Error {
  constructor(code, detail) {
    super(code === "pack_changed"
      ? "El pack ha cambiado mientras se preparaba la partida. Vuelve a intentarlo."
      : `No se pudo crear el snapshot competitivo verificado. (${detail})`);
    this.name = "CompetitionSnapshotError";
    this.code = code;
    this.detail = detail;
  }
}

function assertIdentityMatches(expected, actual) {
  for (const field of IDENTITY_FIELDS) {
    if (expected?.[field] !== actual?.[field]) {
      throw new CompetitionSnapshotError("pack_changed", `${field} no coincide`);
    }
  }
}

function parseManifestBytes(bytes, expectedPackId) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CompetitionManifestError("invalid_manifest", `JSON invalido: ${error.message}`);
  }
  validateManifestShape(manifest);
  if (!canonicalManifestBytes(manifest).equals(bytes)) {
    throw new CompetitionManifestError("noncanonical_manifest", "los bytes del manifest no son canonicos");
  }
  if (manifest.packId !== expectedPackId) {
    throw new CompetitionManifestError("pack_id_mismatch", "packId no coincide");
  }
  return manifest;
}

async function writeWhole(fileHandle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await fileHandle.write(buffer, offset, buffer.length - offset);
    if (!result.bytesWritten) throw new CompetitionSnapshotError("copy_failed", "escritura incompleta");
    offset += result.bytesWritten;
  }
}

async function copyAndVerifyFile(sourcePath, destinationPath, manifestEntry, options = {}) {
  const sourceLstat = await fsp.lstat(sourcePath).catch((error) => {
    if (error?.code === "ENOENT") throw new CompetitionManifestError("missing_critical_file", `falta ${manifestEntry.path}`);
    throw error;
  });
  if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
    throw new CompetitionManifestError(sourceLstat.isSymbolicLink() ? "symlink" : "special_entry", `entrada no regular: ${manifestEntry.path}`);
  }

  await options.beforeCopy?.({ entry: manifestEntry, sourcePath });
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.copy-${crypto.randomBytes(6).toString("hex")}`;
  let sourceHandle;
  let destinationHandle;
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  try {
    sourceHandle = await fsp.open(sourcePath, fs.constants.O_RDONLY);
    const openedStat = await sourceHandle.stat();
    if (!openedStat.isFile()) throw new CompetitionManifestError("special_entry", `entrada no regular: ${manifestEntry.path}`);
    destinationHandle = await fsp.open(temporaryPath, "wx");
    let chunkIndex = 0;
    for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      await writeWhole(destinationHandle, chunk);
      await options.onCopyChunk?.({ chunkIndex, entry: manifestEntry, sizeBytes, sourcePath });
      chunkIndex += 1;
    }
    await destinationHandle.sync();
    await destinationHandle.close();
    destinationHandle = null;
    await sourceHandle.close();
    sourceHandle = null;
    const digest = hash.digest("hex");
    if (sizeBytes !== manifestEntry.sizeBytes) {
      throw new CompetitionManifestError("size_mismatch", `tamano distinto durante copy: ${manifestEntry.path}`);
    }
    if (digest !== manifestEntry.sha256) {
      throw new CompetitionManifestError("hash_mismatch", `hash distinto durante copy: ${manifestEntry.path}`);
    }
    await fsp.rename(temporaryPath, destinationPath);
    await options.afterCopy?.({ destinationPath, entry: manifestEntry, sourcePath });
    return { path: manifestEntry.path, sha256: digest, sizeBytes };
  } catch (error) {
    await destinationHandle?.close().catch(() => null);
    await sourceHandle?.close().catch(() => null);
    await fsp.rm(temporaryPath, { force: true }).catch(() => null);
    throw error;
  }
}

async function copySupplementalDirectory(sourceDir, destinationDir) {
  let entries;
  try {
    const stat = await fsp.lstat(sourceDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CompetitionSnapshotError("unsafe_supplemental", "samples no es un directorio regular");
    entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const copied = [];
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const stat = await fsp.lstat(sourcePath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new CompetitionSnapshotError("unsafe_supplemental", `samples contiene una entrada no permitida: ${entry.name}`);
    }
    if (stat.isDirectory()) copied.push(...await copySupplementalDirectory(sourcePath, destinationPath));
    else {
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.copyFile(sourcePath, destinationPath);
      copied.push(destinationPath);
    }
  }
  return copied;
}

async function createVerifiedCompetitionSnapshot(cachedPack, snapshotRoot, options = {}) {
  if (!cachedPack?.packRoot) throw new CompetitionSnapshotError("missing_pack_root", "falta packRoot");
  const fresh = (options.loadPackFromDirImpl || loadPackFromDir)(cachedPack.packRoot);
  if (!fresh.loaded || fresh.errors.length > 0 || fresh.pack?.contract?.version !== 2) {
    throw new CompetitionSnapshotError("invalid_fresh_pack", fresh.errors?.join(" ") || "pack v2 invalido");
  }
  assertIdentityMatches(cachedPack, fresh.pack);

  const manifestPath = path.join(fresh.pack.packRoot, COMPETITION_MANIFEST_FILENAME);
  const manifestBytes = await fsp.readFile(manifestPath);
  const manifest = parseManifestBytes(manifestBytes, fresh.pack.packId);
  const relevant = await listCompetitionRelevantFiles(fresh.pack);
  if (JSON.stringify(relevant.map((entry) => entry.path)) !== JSON.stringify(manifest.files.map((entry) => entry.path))) {
    throw new CompetitionManifestError("coverage_mismatch", "faltan o sobran archivos competitivos en el manifest");
  }

  await fsp.mkdir(snapshotRoot, { recursive: true });
  const copiedFiles = [];
  for (let index = 0; index < manifest.files.length; index += 1) {
    const manifestEntry = manifest.files[index];
    copiedFiles.push(await copyAndVerifyFile(
      relevant[index].absolutePath,
      path.join(snapshotRoot, ...manifestEntry.path.split("/")),
      manifestEntry,
      options,
    ));
  }
  await fsp.writeFile(path.join(snapshotRoot, COMPETITION_MANIFEST_FILENAME), manifestBytes, { flag: "wx" });

  const sourceSamples = fresh.pack.contract.mame?.sampleDir;
  const snapshotSamples = fresh.pack.contract.mame?.samplePath
    ? path.join(snapshotRoot, ...fresh.pack.contract.mame.samplePath.split(/[\\/]/))
    : null;
  const supplementalSamples = sourceSamples && snapshotSamples
    ? await copySupplementalDirectory(sourceSamples, snapshotSamples)
    : [];

  const snapshot = (options.loadSnapshotPackImpl || loadPackFromDir)(snapshotRoot);
  if (!snapshot.loaded || snapshot.errors.length > 0) {
    throw new CompetitionSnapshotError("snapshot_reparse_failed", snapshot.errors?.join(" ") || "pack.json no se pudo reparsear");
  }
  assertIdentityMatches(fresh.pack, snapshot.pack);
  const verified = await (options.verifySnapshotImpl || verifyCompetitionManifest)(snapshot.pack);
  if (verified.manifestSha256 !== sha256(manifestBytes)) {
    throw new CompetitionSnapshotError("snapshot_manifest_changed", "manifestSha256 no coincide");
  }
  return {
    copiedFiles,
    freshPack: fresh.pack,
    manifest: verified.manifest,
    manifestSha256: verified.manifestSha256,
    snapshotPack: snapshot.pack,
    snapshotRoot,
    supplementalSamples,
  };
}

module.exports = {
  CompetitionSnapshotError,
  IDENTITY_FIELDS,
  assertIdentityMatches,
  copyAndVerifyFile,
  createVerifiedCompetitionSnapshot,
  parseManifestBytes,
};
