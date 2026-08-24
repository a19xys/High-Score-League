const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { readPackDirectory, getDirectoryKey } = require("./pack-directory");
const { loadPackFromDir } = require("./pack");
const { verifyCompetitionManifest, sha256 } = require("./competition-manifest");
const { findInstalledPackByIdForConfig, stagePackZipForUpdate } = require("./pack-importer");
const {
  cleanupDownloadedArtifact,
  downloadPackArtifact,
  requestPackDescriptor,
} = require("./remote-pack-import");
const {
  getPackProvenanceReceiptPath,
  readPackProvenanceReceipt,
  writePackProvenanceReceipt,
} = require("./pack-provenance");
const { isRemotePackId } = require("./pack-deeplink");
const { atomicWriteJson } = require("./secure-session-storage");

const UPDATE_JOURNAL_SCHEMA_VERSION = 1;
const UPDATE_STAGING_PREFIX = ".hsl-update-";
const UPDATE_BACKUP_PREFIX = ".hsl-update-backup-";
const TRANSACTION_ID_PATTERN = /^[0-9a-f]{24}$/;
const JOURNAL_PHASES = new Set([
  "prepared",
  "old-backed-up",
  "target-installed",
  "provenance-written",
  "core-committed",
  "post-commit-pending",
]);

class RemotePackUpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RemotePackUpdateError";
    this.code = code;
  }
}

function updateError(code, message) {
  return new RemotePackUpdateError(code, message);
}

function isInside(parentDir, childPath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeDirectChildName(value, prefix = null) {
  if (typeof value !== "string" || !value || value !== path.basename(value) || /[\\/\0]/.test(value)) return null;
  if (prefix && !value.startsWith(prefix)) return null;
  return value;
}

function journalDirectory(config = {}) {
  if (!config.userDataDir) throw updateError("library_unavailable", "No se pudo resolver userData para actualizar el pack.");
  return path.join(config.userDataDir, "pack-updates");
}

function journalPath(config, transactionId) {
  if (!TRANSACTION_ID_PATTERN.test(transactionId || "")) throw updateError("invalid_transaction", "La transacción de actualización no es válida.");
  return path.join(journalDirectory(config), `${transactionId}.json`);
}

function journalPayload(base, patch = {}, nowIso = new Date().toISOString()) {
  return {
    ...base,
    ...patch,
    schemaVersion: UPDATE_JOURNAL_SCHEMA_VERSION,
    updatedAt: nowIso,
  };
}

async function writeJournal(config, journal, options = {}) {
  const next = journalPayload(journal, options.patch || {}, options.nowIso);
  await (options.atomicWriteImpl || atomicWriteJson)(journalPath(config, next.transactionId), next);
  return next;
}

function validateJournal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== UPDATE_JOURNAL_SCHEMA_VERSION || !TRANSACTION_ID_PATTERN.test(value.transactionId || "")) return null;
  if (!JOURNAL_PHASES.has(value.phase) || !isRemotePackId(value.oldPackId) || !isRemotePackId(value.targetPackId)) return null;
  if (typeof value.weekId !== "string" || !value.weekId || typeof value.gameId !== "string" || !value.gameId) return null;
  if (!safeDirectChildName(value.packBasename) || value.packBasename.startsWith(".hsl-")) return null;
  if (value.stagingBasename !== `${UPDATE_STAGING_PREFIX}${value.transactionId}`) return null;
  if (value.backupBasename !== `${UPDATE_BACKUP_PREFIX}${value.transactionId}`) return null;
  if (typeof value.libraryKey !== "string" || !value.libraryKey) return null;
  if (!/^[0-9a-f]{64}$/.test(value.artifactSha256 || "") || !/^[0-9a-f]{64}$/.test(value.manifestSha256 || "")) return null;
  if (!Number.isSafeInteger(value.artifactSizeBytes) || value.artifactSizeBytes <= 0) return null;
  if (typeof value.provenanceCreated !== "boolean" || typeof value.targetReceiptPreexisting !== "boolean") return null;
  if (![value.createdAt, value.updatedAt].every((date) => (
    typeof date === "string"
    && !Number.isNaN(Date.parse(date))
    && new Date(date).toISOString() === date
  ))) return null;
  return { ...value };
}

async function configuredLibraryRoot(config) {
  const directory = await readPackDirectory(config);
  if (!directory.directoryPath || !directory.exists || directory.looksLikePackRoot) {
    throw updateError("library_unavailable", "La Biblioteca no está disponible para actualizar el pack.");
  }
  const root = path.resolve(directory.directoryPath);
  const stat = await fsp.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw updateError("library_unavailable", "La Biblioteca no es una carpeta segura.");
  return { libraryKey: getDirectoryKey(root), root, realRoot: await fsp.realpath(root) };
}

async function assertSafeTransactionPath(rootState, candidatePath, options = {}) {
  const resolved = path.resolve(candidatePath);
  if (path.dirname(resolved) !== rootState.root || !isInside(rootState.root, resolved)) {
    throw updateError("unsafe_update_path", "La ruta de actualización no pertenece a la Biblioteca.");
  }
  try {
    const stat = await fsp.lstat(resolved);
    if (stat.isSymbolicLink()) throw updateError("unsafe_update_path", "La actualización no admite enlaces simbólicos.");
    if (options.directory !== false && !stat.isDirectory()) throw updateError("unsafe_update_path", "La ruta de actualización no es una carpeta.");
    const real = await fsp.realpath(resolved);
    if (!isInside(rootState.realRoot, real)) throw updateError("unsafe_update_path", "La ruta real escapa de la Biblioteca.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved;
}

async function readInstalledIdentity(packDir, expected = {}) {
  const loaded = loadPackFromDir(packDir);
  if (!loaded.loaded || loaded.errors?.length > 0 || !loaded.pack) {
    throw updateError("invalid_installation", "La instalación local no se puede verificar.");
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && value !== null && loaded.pack[field] !== value) {
      throw updateError("revision_conflict", `La identidad local cambió en ${field}.`);
    }
  }
  const [packJsonBytes, manifest] = await Promise.all([
    fsp.readFile(path.join(packDir, "pack.json")),
    verifyCompetitionManifest(loaded.pack),
  ]);
  return {
    fingerprint: `${sha256(packJsonBytes)}:${manifest.manifestSha256}`,
    manifest,
    pack: loaded.pack,
    packDir: path.resolve(packDir),
  };
}

function matchingProvenance(config, journal) {
  return readPackProvenanceReceipt(config, journal.targetPackId, {
    artifactSha256: journal.artifactSha256,
    artifactSizeBytes: journal.artifactSizeBytes,
    competitionManifestSha256: journal.manifestSha256,
  });
}

async function removeTransactionProvenance(config, journal) {
  if (journal.targetReceiptPreexisting) return false;
  const receipt = matchingProvenance(config, journal);
  if (!receipt.ok || !receipt.receiptPath) return false;
  if (receipt.receipt?.importedAt !== journal.createdAt) return false;
  const expectedPath = getPackProvenanceReceiptPath(config, journal.targetPackId);
  if (path.resolve(receipt.receiptPath) !== path.resolve(expectedPath)) return false;
  await fsp.rm(expectedPath, { force: true });
  return true;
}

async function safeRemoveTransactionDir(rootState, targetPath, prefix, expectedPackId = null) {
  const safe = await assertSafeTransactionPath(rootState, targetPath);
  if (!safeDirectChildName(path.basename(safe), prefix)) throw updateError("unsafe_update_path", "El prefijo de la carpeta transaccional no es válido.");
  try {
    await fsp.lstat(safe);
    if (expectedPackId) await readInstalledIdentity(safe, { packId: expectedPackId });
    await fsp.rm(safe, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeJournal(config, transactionId) {
  await fsp.rm(journalPath(config, transactionId), { force: true });
}

async function recoverOnePackUpdate(config, rawJournal, options = {}) {
  const journal = validateJournal(rawJournal);
  if (!journal) return { status: "invalid-journal" };
  const rootState = await configuredLibraryRoot(config);
  if (journal.libraryKey !== rootState.libraryKey) return { journal, status: "library-mismatch" };
  const finalDir = await assertSafeTransactionPath(rootState, path.join(rootState.root, journal.packBasename));
  const stagingDir = await assertSafeTransactionPath(rootState, path.join(rootState.root, journal.stagingBasename));
  const backupDir = await assertSafeTransactionPath(rootState, path.join(rootState.root, journal.backupBasename));

  const identity = async (target, expected) => {
    try { return await readInstalledIdentity(target, expected); } catch { return null; }
  };
  const [finalOld, finalTarget, backupOld] = await Promise.all([
    identity(finalDir, { packId: journal.oldPackId, weekId: journal.weekId, gameId: journal.gameId }),
    identity(finalDir, { packId: journal.targetPackId, weekId: journal.weekId, gameId: journal.gameId }),
    identity(backupDir, { packId: journal.oldPackId, weekId: journal.weekId, gameId: journal.gameId }),
  ]);
  const provenance = matchingProvenance(config, journal);
  const coreCommitted = ["core-committed", "post-commit-pending"].includes(journal.phase);

  if (finalOld && !backupOld) {
    await safeRemoveTransactionDir(rootState, stagingDir, UPDATE_STAGING_PREFIX, journal.targetPackId).catch(() => false);
    await removeJournal(config, journal.transactionId);
    return { journal, status: "old-preserved" };
  }
  if (!finalOld && !finalTarget && backupOld) {
    await fsp.rename(backupDir, finalDir);
    await safeRemoveTransactionDir(rootState, stagingDir, UPDATE_STAGING_PREFIX, journal.targetPackId).catch(() => false);
    await removeTransactionProvenance(config, journal);
    await removeJournal(config, journal.transactionId);
    return { journal, status: "old-restored" };
  }
  if (finalTarget && coreCommitted && provenance.ok) {
    if (typeof options.onBookkeeping === "function") await options.onBookkeeping(journal, finalTarget.pack);
    if (backupOld) await safeRemoveTransactionDir(rootState, backupDir, UPDATE_BACKUP_PREFIX, journal.oldPackId);
    await safeRemoveTransactionDir(rootState, stagingDir, UPDATE_STAGING_PREFIX, journal.targetPackId).catch(() => false);
    await removeJournal(config, journal.transactionId);
    return { journal, pack: finalTarget.pack, status: "target-converged" };
  }
  if (finalTarget && backupOld && !coreCommitted) {
    const rollbackDir = stagingDir;
    const stagingExists = await identity(stagingDir, { packId: journal.targetPackId });
    if (stagingExists) return { journal, status: "ambiguous-preserved" };
    await fsp.rename(finalDir, rollbackDir);
    await fsp.rename(backupDir, finalDir);
    await removeTransactionProvenance(config, journal);
    await safeRemoveTransactionDir(rootState, rollbackDir, UPDATE_STAGING_PREFIX, journal.targetPackId);
    await removeJournal(config, journal.transactionId);
    return { journal, status: "target-rolled-back" };
  }
  return { journal, status: "ambiguous-preserved" };
}

async function recoverPackUpdates(config, options = {}) {
  const directory = journalDirectory(config);
  let entries;
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
  catch (error) { return error?.code === "ENOENT" ? [] : [{ status: "journal-directory-unavailable" }]; }
  const results = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/^[0-9a-f]{24}\.json$/.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = await fsp.lstat(filePath);
      if (stat.isSymbolicLink()) { results.push({ status: "invalid-journal" }); continue; }
      const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
      results.push(await recoverOnePackUpdate(config, parsed, options));
    } catch {
      results.push({ status: "invalid-journal" });
    }
  }
  return results;
}

function classifyUpdateFailure(error) {
  const code = String(error?.code || "");
  if (code === "target_not_current") return "target-not-current";
  if (code === "revision_conflict") return "revision-conflict";
  if (code === "operation_busy") return "operation-busy";
  if (code === "library_unavailable") return "library-unavailable";
  if (code === "cancelled") return "cancelled";
  if (code === "download_integrity_failed") return "download-integrity-failed";
  if (code === "pack_unavailable") return "pack-unavailable";
  if (code === "requires_login") return "requires-login";
  if (code === "offline") return "offline";
  if (code === "unexpected_pack_id") return "unexpected-pack-id";
  return "remote-error";
}

async function executeRemotePackUpdate(options = {}) {
  const config = options.config || {};
  const old = options.oldPack || {};
  const targetPackId = options.targetPackId;
  if (!isRemotePackId(targetPackId) || !isRemotePackId(old.packId) || old.packId === targetPackId) {
    return { status: "revision-conflict" };
  }
  let download = null;
  let journal = null;
  let rootState = null;
  let stagingDir = null;
  try {
    rootState = await configuredLibraryRoot(config);
    const finalDir = await assertSafeTransactionPath(rootState, old.packDir);
    if (path.dirname(finalDir) !== rootState.root) throw updateError("revision_conflict", "El pack no es hijo directo de la Biblioteca.");
    const initial = await readInstalledIdentity(finalDir, {
      gameId: old.gameId,
      packId: old.packId,
      weekId: old.weekId,
    });
    const existingTarget = await findInstalledPackByIdForConfig(config, targetPackId);
    if (existingTarget) throw updateError("revision_conflict", "La revisión target ya existe en otra instalación.");

    options.onPhase?.("Preparando actualización…");
    const descriptorResult = await (options.requestPackDescriptorImpl || requestPackDescriptor)({
      ...options,
      packId: targetPackId,
    });
    if (descriptorResult.status !== "ready") return descriptorResult;
    options.onPhase?.("Descargando actualización…");
    download = await (options.downloadPackArtifactImpl || downloadPackArtifact)({
      descriptor: descriptorResult.descriptor,
      fetchImpl: options.fetchImpl,
      maxPackBytes: options.maxPackBytes,
      signal: options.signal,
      tempBaseDir: options.tempBaseDir,
      timeoutMs: options.downloadTimeoutMs,
    });
    const transactionId = (options.createTransactionId || (() => crypto.randomBytes(12).toString("hex")))();
    if (!TRANSACTION_ID_PATTERN.test(transactionId)) throw updateError("invalid_transaction", "No se pudo crear una transacción segura.");
    stagingDir = path.join(rootState.root, `${UPDATE_STAGING_PREFIX}${transactionId}`);
    const backupDir = path.join(rootState.root, `${UPDATE_BACKUP_PREFIX}${transactionId}`);
    await Promise.all([
      assertSafeTransactionPath(rootState, stagingDir),
      assertSafeTransactionPath(rootState, backupDir),
    ]);
    options.onPhase?.("Verificando actualización…");
    const staged = await (options.stagePackZipForUpdateImpl || stagePackZipForUpdate)(
      download.filePath,
      stagingDir,
      { ...(options.importOptions || {}), expectedPackId: targetPackId },
    );
    if (staged.pack.packId !== targetPackId
        || staged.pack.weekId !== initial.pack.weekId
        || staged.pack.gameId !== initial.pack.gameId) {
      throw updateError("revision_conflict", "La revisión target no pertenece a la misma familia.");
    }
    let beforeCommit;
    try {
      beforeCommit = await readInstalledIdentity(finalDir, {
        gameId: initial.pack.gameId,
        packId: initial.pack.packId,
        weekId: initial.pack.weekId,
      });
    } catch {
      throw updateError("revision_conflict", "El pack local cambió durante la actualización.");
    }
    if (beforeCommit.fingerprint !== initial.fingerprint) throw updateError("revision_conflict", "El pack local cambió durante la actualización.");
    const existingReceipt = readPackProvenanceReceipt(config, targetPackId);
    if (existingReceipt.exists && !existingReceipt.ok) throw updateError("revision_conflict", "Existe provenance previa incompatible para el target.");
    if (existingReceipt.ok && !readPackProvenanceReceipt(config, targetPackId, {
      artifactSha256: descriptorResult.descriptor.artifact.sha256,
      artifactSizeBytes: download.bytes,
      competitionManifestSha256: staged.manifest.manifestSha256,
    }).ok) {
      throw updateError("revision_conflict", "Existe provenance previa distinta para el target.");
    }
    if (await options.isOperationBlocked?.()) throw updateError("operation_busy", "Cierra MAME o la otra operación antes de actualizar.");
    const authority = await options.ensureFreshCapability?.(initial.pack.weekId);
    const capability = authority?.capability || authority;
    if (authority?.ok !== true || !Object.hasOwn(capability || {}, "publishedPackId") || capability.publishedPackId !== targetPackId) {
      throw updateError("target_not_current", "La revisión solicitada ya no es la publicada.");
    }
    const nowIso = options.nowIso || new Date().toISOString();
    journal = await writeJournal(config, {
      artifactSha256: descriptorResult.descriptor.artifact.sha256,
      artifactSizeBytes: download.bytes,
      backupBasename: path.basename(backupDir),
      createdAt: nowIso,
      gameId: initial.pack.gameId,
      libraryKey: rootState.libraryKey,
      manifestSha256: staged.manifest.manifestSha256,
      oldPackId: initial.pack.packId,
      packBasename: path.basename(finalDir),
      phase: "prepared",
      provenanceCreated: false,
      schemaVersion: UPDATE_JOURNAL_SCHEMA_VERSION,
      stagingBasename: path.basename(stagingDir),
      targetPackId,
      targetReceiptPreexisting: existingReceipt.ok,
      transactionId,
      updatedAt: nowIso,
      weekId: initial.pack.weekId,
    }, { nowIso, atomicWriteImpl: options.atomicWriteImpl });

    options.onPhase?.("Instalando actualización…");
    await fsp.rename(finalDir, backupDir);
    journal = await writeJournal(config, journal, { patch: { phase: "old-backed-up" }, atomicWriteImpl: options.atomicWriteImpl });
    await fsp.rename(stagingDir, finalDir);
    stagingDir = null;
    journal = await writeJournal(config, journal, { patch: { phase: "target-installed" }, atomicWriteImpl: options.atomicWriteImpl });
    const finalTarget = await readInstalledIdentity(finalDir, {
      gameId: initial.pack.gameId,
      packId: targetPackId,
      weekId: initial.pack.weekId,
    });
    if (finalTarget.manifest.manifestSha256 !== staged.manifest.manifestSha256) {
      throw updateError("revision_conflict", "El target final no coincide con el staging verificado.");
    }
    if (!existingReceipt.ok) {
      await (options.writePackProvenanceReceiptImpl || writePackProvenanceReceipt)(config, {
        artifactSha256: descriptorResult.descriptor.artifact.sha256,
        artifactSizeBytes: download.bytes,
        competitionManifestSha256: finalTarget.manifest.manifestSha256,
        importedAt: nowIso,
        packId: targetPackId,
      });
      journal = await writeJournal(config, journal, {
        patch: { phase: "provenance-written", provenanceCreated: true },
        atomicWriteImpl: options.atomicWriteImpl,
      });
    }
    journal = await writeJournal(config, journal, { patch: { phase: "core-committed" }, atomicWriteImpl: options.atomicWriteImpl });

    try {
      await options.onBookkeeping?.(journal, finalTarget.pack);
    } catch (error) {
      journal = await writeJournal(config, journal, { patch: { phase: "post-commit-pending" }, atomicWriteImpl: options.atomicWriteImpl });
      return { journal, pack: finalTarget.pack, packDir: finalDir, status: "updated", warnings: [error.message] };
    }
    await safeRemoveTransactionDir(rootState, backupDir, UPDATE_BACKUP_PREFIX, initial.pack.packId);
    await removeJournal(config, transactionId);
    return { pack: finalTarget.pack, packDir: finalDir, status: "updated", warnings: staged.warnings || [] };
  } catch (error) {
    const recovery = journal
      ? await recoverOnePackUpdate(config, journal, { onBookkeeping: options.onBookkeeping }).catch(() => null)
      : null;
    if (recovery?.status === "target-converged") {
      return {
        pack: recovery.pack,
        packDir: old.packDir,
        status: "updated",
        warnings: ["La actualización se completó durante la recuperación local."],
      };
    }
    if (!journal && stagingDir && rootState) await safeRemoveTransactionDir(rootState, stagingDir, UPDATE_STAGING_PREFIX, targetPackId).catch(() => null);
    return { diagnosticCode: error?.code || error?.name || "Error", status: classifyUpdateFailure(error) };
  } finally {
    await (options.cleanupDownloadedArtifactImpl || cleanupDownloadedArtifact)(download);
  }
}

module.exports = {
  JOURNAL_PHASES,
  RemotePackUpdateError,
  UPDATE_BACKUP_PREFIX,
  UPDATE_JOURNAL_SCHEMA_VERSION,
  UPDATE_STAGING_PREFIX,
  classifyUpdateFailure,
  executeRemotePackUpdate,
  journalDirectory,
  journalPath,
  recoverOnePackUpdate,
  recoverPackUpdates,
  validateJournal,
};
