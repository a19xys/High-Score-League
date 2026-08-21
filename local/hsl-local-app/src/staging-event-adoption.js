const fsp = require("node:fs/promises");
const path = require("node:path");
const { listJsonFiles, readEventFile } = require("./event-files");
const { moveFileSafe, writeRejectionNote } = require("./file-queue");

async function listPendingFileSnapshot(dir) {
  try {
    const files = await listJsonFiles(dir);
    const snapshot = new Map();

    for (const filename of files) {
      const fullPath = path.join(dir, filename);
      const stat = await fsp.stat(fullPath);
      snapshot.set(filename, {
        filename,
        mtimeMs: stat.mtimeMs,
      });
    }

    return snapshot;
  } catch {
    return new Map();
  }
}

async function adoptNewStagingEvents(stagingPendingDir, scopedPendingDir, snapshot = new Map(), startedAtMs = 0, options = {}) {
  const files = await listJsonFiles(stagingPendingDir).catch(() => []);
  const adopted = [];
  const skippedLegacy = [];
  const rejected = [];

  await fsp.mkdir(scopedPendingDir, { recursive: true });

  for (const filename of files) {
    const sourcePath = path.join(stagingPendingDir, filename);
    let stat;
    try {
      stat = await fsp.stat(sourcePath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const previous = snapshot.get(filename);
    const isNew = !previous;
    const isUpdatedDuringRun = Boolean(previous && stat.mtimeMs > previous.mtimeMs && stat.mtimeMs >= startedAtMs);

    if (!isNew && !isUpdatedDuringRun) {
      skippedLegacy.push(filename);
      continue;
    }

    if (options.competitionGuard) {
      if (!options.scopedRejectedDir) throw new Error("Una run protegida requiere scopedRejectedDir.");
      const parsed = await readEventFile(stagingPendingDir, filename, { competitionGuard: options.competitionGuard });
      const violations = Array.isArray(parsed.event?.competitionIntegrity?.violations)
        ? parsed.event.competitionIntegrity.violations
        : [];
      if (!parsed.ok || violations.length > 0) {
        await fsp.mkdir(options.scopedRejectedDir, { recursive: true });
        const finalPath = await moveFileSafe(sourcePath, path.join(options.scopedRejectedDir, filename));
        const reason = violations.length > 0
          ? `Partida no valida por integridad competitiva: ${violations.join(", ")}.`
          : `Partida no valida por integridad competitiva: ${parsed.errors.join("; ")}.`;
        const notePath = await writeRejectionNote({ eventsRejectedDirAbs: options.scopedRejectedDir }, path.basename(finalPath), {
          domainCode: "LOCAL_COMPETITION_INTEGRITY",
          httpStatus: 0,
          reason,
        });
        rejected.push({ errors: parsed.errors, filename, finalPath, notePath, violations });
        continue;
      }
    }

    const finalPath = await moveFileSafe(sourcePath, path.join(scopedPendingDir, filename));
    adopted.push({
      filename,
      finalPath,
      restoredFilename: path.basename(finalPath),
    });
  }

  return {
    adopted,
    rejected,
    skippedLegacy,
  };
}

module.exports = {
  adoptNewStagingEvents,
  listPendingFileSnapshot,
};
