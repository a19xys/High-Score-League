const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  atomicWriteBytes,
  canonicalJsonBytes,
  sha256Bytes,
} = require("./run-input-integrity");

const OUTPUT_MONITOR_ARMED_FILENAME = "candidate-output-monitor-armed.marker";
const MAX_OUTPUT_BYTES = 512 * 1024;
const FINAL_PATTERNS = Object.freeze({
  candidate: /^candidate_([0-9]{6})\.json$/,
  commitment: /^commitment_([0-9]{6})\.json$/,
});
const TEMP_PATTERNS = Object.freeze({
  candidate: /^candidate_[0-9]{6}\.json\.tmp$/,
  commitment: /^commitment_[0-9]{6}\.json\.tmp$/,
});

async function readExactOutput(filePath) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_OUTPUT_BYTES) {
    throw new Error(`Output competitivo no regular o fuera de limite: ${path.basename(filePath)}.`);
  }
  const bytes = await fsp.readFile(filePath);
  return { sha256: sha256Bytes(bytes), sizeBytes: bytes.length };
}

async function assertOutputDirectory(directoryPath) {
  const stat = await fsp.lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Directorio de outputs invalido: ${directoryPath}.`);
}

function observationArray(map, field) {
  return [...map.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map((item) => ({ sequence: item.sequence, [field]: item.filename, sha256: item.sha256, sizeBytes: item.sizeBytes }));
}

async function createCompetitionOutputMonitor(run, options = {}) {
  await Promise.all([
    assertOutputDirectory(run.stagingCandidatesDir),
    assertOutputDirectory(run.stagingCommitmentsDir),
  ]);
  const armedAt = options.nowIso || new Date().toISOString();
  await atomicWriteBytes(
    path.join(run.integrityDir, "app", OUTPUT_MONITOR_ARMED_FILENAME),
    canonicalJsonBytes({ version: 1, runId: run.runId, armedAt }),
  );

  const maps = { candidate: new Map(), commitment: new Map() };
  const violations = new Set();
  const watchers = [];
  const watchedFinalFiles = new Set();
  let closing = false;
  let closed = false;
  let scanChain = Promise.resolve();

  const markUnavailable = () => violations.add("integrity_unavailable");
  const watchFinalFile = (kind, directoryPath, observation) => {
    const key = `${kind}:${observation.filename}`;
    if (watchedFinalFiles.has(key)) return;
    watchedFinalFiles.add(key);
    try {
      const watcher = (options.outputFileWatchImpl || fs.watch)(
        path.join(directoryPath, observation.filename),
        { persistent: false },
        markUnavailable,
      );
      watcher.on?.("error", markUnavailable);
      watcher.on?.("close", () => { if (!closing) markUnavailable(); });
      watchers.push(watcher);
    } catch {
      markUnavailable();
    }
  };
  const scanKind = async (kind, allowNew) => {
    const directoryPath = kind === "candidate" ? run.stagingCandidatesDir : run.stagingCommitmentsDir;
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    const present = new Set();
    for (const entry of entries) {
      if (TEMP_PATTERNS[kind].test(entry.name)) continue;
      const match = FINAL_PATTERNS[kind].exec(entry.name);
      if (!match || !entry.isFile() || entry.isSymbolicLink()) {
        markUnavailable();
        continue;
      }
      present.add(entry.name);
      const observed = maps[kind].get(entry.name);
      if (!observed && !allowNew) {
        markUnavailable();
        continue;
      }
      let exact;
      try { exact = await readExactOutput(path.join(directoryPath, entry.name)); }
      catch { markUnavailable(); continue; }
      if (!observed) {
        const observation = {
          filename: entry.name,
          sequence: Number(match[1]),
          sha256: exact.sha256,
          sizeBytes: exact.sizeBytes,
        };
        maps[kind].set(entry.name, observation);
        watchFinalFile(kind, directoryPath, observation);
        try {
          Promise.resolve(options.onOutputObservation?.(Object.freeze({ kind, ...observation }))).catch(markUnavailable);
        } catch {
          markUnavailable();
        }
      } else if (observed.sha256 !== exact.sha256 || observed.sizeBytes !== exact.sizeBytes) {
        markUnavailable();
      }
    }
    for (const filename of maps[kind].keys()) if (!present.has(filename)) markUnavailable();
  };
  const scan = (allowNew = true) => {
    scanChain = scanChain.then(async () => {
      await scanKind("candidate", allowNew);
      await scanKind("commitment", allowNew);
    }).catch(markUnavailable);
    return scanChain;
  };

  await scan(false);
  if (violations.size > 0) throw new Error("Los directorios de candidates no estaban vacios al armar el monitor.");

  try {
    for (const directoryPath of [run.stagingCandidatesDir, run.stagingCommitmentsDir]) {
      const watcher = (options.outputWatchImpl || fs.watch)(directoryPath, { persistent: false }, () => scan(true));
      watcher.on?.("error", markUnavailable);
      watcher.on?.("close", () => { if (!closing) markUnavailable(); });
      watchers.push(watcher);
    }
  } catch (error) {
    closing = true;
    for (const watcher of watchers) watcher.close?.();
    markUnavailable();
    throw new Error(`No se pudo vigilar outputs competitivos: ${error.message}`);
  }

  const snapshot = async () => {
    await scanChain;
    return {
      version: 1,
      runId: run.runId,
      candidates: observationArray(maps.candidate, "candidateFile"),
      commitments: observationArray(maps.commitment, "commitmentFile"),
      violations: violations.has("integrity_unavailable") ? ["integrity_unavailable"] : [],
    };
  };

  return {
    async close() {
      if (!closed) {
        closing = true;
        for (const watcher of watchers) watcher.close?.();
        closed = true;
      }
      await scanChain;
      await scan(false);
      return snapshot();
    },
    markUnavailable,
    scan,
    snapshot,
  };
}

module.exports = {
  OUTPUT_MONITOR_ARMED_FILENAME,
  createCompetitionOutputMonitor,
  readExactOutput,
};
