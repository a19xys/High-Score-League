const fsp = require("node:fs/promises");
const path = require("node:path");
const { listJsonFiles } = require("./event-files");
const { moveFileSafe } = require("./file-queue");

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

async function adoptNewStagingEvents(stagingPendingDir, scopedPendingDir, snapshot = new Map(), startedAtMs = 0) {
  const files = await listJsonFiles(stagingPendingDir).catch(() => []);
  const adopted = [];
  const skippedLegacy = [];

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

    const finalPath = await moveFileSafe(sourcePath, path.join(scopedPendingDir, filename));
    adopted.push({
      filename,
      finalPath,
      restoredFilename: path.basename(finalPath),
    });
  }

  return {
    adopted,
    skippedLegacy,
  };
}

module.exports = {
  adoptNewStagingEvents,
  listPendingFileSnapshot,
};
