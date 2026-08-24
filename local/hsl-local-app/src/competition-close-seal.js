const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  atomicWriteBytes,
  canonicalJsonBytes,
  readRunInputState,
  sha256Bytes,
} = require("./run-input-integrity");
const { OUTPUT_MONITOR_ARMED_FILENAME } = require("./competition-output-monitor");

const APP_CLOSE_SEAL_FILENAME = "app-close-seal.json";
const MAX_SEAL_INPUT_BYTES = 512 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function exactKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
}

async function readRegularBytes(filePath, options = {}) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (!options.allowEmpty && stat.size <= 0) || stat.size > MAX_SEAL_INPUT_BYTES) {
    throw new Error(`Archivo no regular para close seal: ${path.basename(filePath)}.`);
  }
  return fsp.readFile(filePath);
}

async function readCanonicalJson(filePath, fields) {
  const bytes = await readRegularBytes(filePath);
  const value = JSON.parse(bytes.toString("utf8"));
  if (!canonicalJsonBytes(value).equals(bytes) || !exactKeys(value, fields)) {
    throw new Error(`${path.basename(filePath)} es invalido.`);
  }
  return value;
}

function pairOutputObservations(outputState) {
  const candidates = new Map((outputState?.candidates || []).map((item) => [item.sequence, item]));
  const commitments = new Map((outputState?.commitments || []).map((item) => [item.sequence, item]));
  const sequences = [...new Set([...candidates.keys(), ...commitments.keys()])].sort((left, right) => left - right);
  const paired = [];
  let incomplete = false;
  for (const sequence of sequences) {
    const candidate = candidates.get(sequence);
    const commitment = commitments.get(sequence);
    if (!candidate || !commitment) { incomplete = true; continue; }
    paired.push({
      sequence,
      candidateFile: candidate.candidateFile,
      candidateSha256: candidate.sha256,
      commitmentFile: commitment.commitmentFile,
      commitmentSha256: commitment.sha256,
    });
  }
  return { incomplete, paired };
}

async function writeCompetitionAppCloseSeal(run, state, options = {}) {
  const [finalMarkerBytes, ledgerBytes] = await Promise.all([
    readRegularBytes(path.join(run.integrityDir, "final.marker")),
    readRegularBytes(run.candidateLedgerPath, { allowEmpty: true }),
  ]);
  const paired = pairOutputObservations(state.outputState);
  const outputViolations = new Set(state.outputState?.violations || []);
  if (paired.incomplete) outputViolations.add("integrity_unavailable");
  const value = {
    version: 1,
    runId: run.runId,
    runInputManifestSha256: run.runInputManifestSha256,
    exitCode: state.exitCode,
    runInputViolations: [...(state.runInputState?.violations || [])],
    outputViolations: outputViolations.has("integrity_unavailable") ? ["integrity_unavailable"] : [],
    finalMarkerSha256: sha256Bytes(finalMarkerBytes),
    candidateLedgerSha256: sha256Bytes(ledgerBytes),
    candidates: paired.paired,
    closedAt: options.nowIso || new Date().toISOString(),
  };
  const filePath = path.join(run.integrityDir, "app", APP_CLOSE_SEAL_FILENAME);
  const bytes = canonicalJsonBytes(value);
  await atomicWriteBytes(filePath, bytes);
  return { bytes, filePath, sha256: sha256Bytes(bytes), value };
}

async function readCompetitionAppCloseSeal(run, options = {}) {
  const filePath = path.join(run.integrityDir, "app", APP_CLOSE_SEAL_FILENAME);
  const bytes = await readRegularBytes(filePath);
  const value = JSON.parse(bytes.toString("utf8"));
  if (!canonicalJsonBytes(value).equals(bytes)
      || !exactKeys(value, [
        "version", "runId", "runInputManifestSha256", "exitCode", "runInputViolations",
        "outputViolations", "finalMarkerSha256", "candidateLedgerSha256", "candidates", "closedAt",
      ]) || value.version !== 1 || value.runId !== run.runId
      || value.runInputManifestSha256 !== run.runInputManifestSha256
      || !Number.isInteger(value.exitCode) || !Array.isArray(value.runInputViolations)
      || !Array.isArray(value.outputViolations) || !Array.isArray(value.candidates)
      || !SHA256_PATTERN.test(value.finalMarkerSha256 || "")
      || !SHA256_PATTERN.test(value.candidateLedgerSha256 || "")
      || typeof value.closedAt !== "string" || Number.isNaN(new Date(value.closedAt).getTime())) {
    throw new Error("app-close-seal.json es invalido.");
  }
  if (Number.isInteger(options.exitCode) && value.exitCode !== options.exitCode) throw new Error("El exit code no coincide con app close seal.");
  if (JSON.stringify(value.runInputViolations) !== JSON.stringify(value.runInputViolations.filter((code, index) => (
    ["run_input_changed", "integrity_unavailable"].includes(code) && value.runInputViolations.indexOf(code) === index
  ))) || JSON.stringify(value.outputViolations) !== JSON.stringify(value.outputViolations.filter((code, index) => (
    code === "integrity_unavailable" && value.outputViolations.indexOf(code) === index
  )))) throw new Error("Las violaciones del app close seal no son canonicas.");

  const [finalMarkerBytes, ledgerBytes, persistedState, mameExit, outputArmed] = await Promise.all([
    readRegularBytes(path.join(run.integrityDir, "final.marker")),
    readRegularBytes(run.candidateLedgerPath, { allowEmpty: true }),
    readRunInputState(run, { required: true }),
    readCanonicalJson(path.join(run.integrityDir, "mame-exit.json"), ["version", "runId", "exitCode", "observedAt"]),
    readCanonicalJson(
      path.join(run.integrityDir, "app", OUTPUT_MONITOR_ARMED_FILENAME),
      ["version", "runId", "armedAt"],
    ),
  ]);
  if (mameExit.version !== 1 || mameExit.runId !== run.runId || !Number.isInteger(mameExit.exitCode)
      || typeof mameExit.observedAt !== "string" || Number.isNaN(new Date(mameExit.observedAt).getTime())
      || mameExit.exitCode !== value.exitCode) {
    throw new Error("mame-exit.json no coincide con app close seal.");
  }
  if (outputArmed.version !== 1 || outputArmed.runId !== run.runId
      || typeof outputArmed.armedAt !== "string" || Number.isNaN(new Date(outputArmed.armedAt).getTime())) {
    throw new Error("El marker armado del monitor de outputs es invalido.");
  }
  if (sha256Bytes(finalMarkerBytes) !== value.finalMarkerSha256) throw new Error("final.marker no coincide con app close seal.");
  if (sha256Bytes(ledgerBytes) !== value.candidateLedgerSha256) throw new Error("candidate-set.log no coincide con app close seal.");
  if (JSON.stringify(persistedState.violations) !== JSON.stringify(value.runInputViolations)) {
    throw new Error("El estado final del monitor de inputs no coincide con app close seal.");
  }
  let previous = 0;
  for (const item of value.candidates) {
    if (!exactKeys(item, ["sequence", "candidateFile", "candidateSha256", "commitmentFile", "commitmentSha256"])
        || !Number.isSafeInteger(item.sequence) || item.sequence !== previous + 1
        || item.candidateFile !== `candidate_${String(item.sequence).padStart(6, "0")}.json`
        || item.commitmentFile !== `commitment_${String(item.sequence).padStart(6, "0")}.json`
        || !SHA256_PATTERN.test(item.candidateSha256 || "") || !SHA256_PATTERN.test(item.commitmentSha256 || "")) {
      throw new Error("Las observaciones de outputs del app close seal no son canonicas.");
    }
    const [candidateBytes, commitmentBytes] = await Promise.all([
      readRegularBytes(path.join(run.stagingCandidatesDir, item.candidateFile)),
      readRegularBytes(path.join(run.stagingCommitmentsDir, item.commitmentFile)),
    ]);
    if (sha256Bytes(candidateBytes) !== item.candidateSha256) throw new Error(`${item.candidateFile} cambio tras su primera observacion.`);
    if (sha256Bytes(commitmentBytes) !== item.commitmentSha256) throw new Error(`${item.commitmentFile} cambio tras su primera observacion.`);
    previous = item.sequence;
  }
  return { bytes, filePath, sha256: sha256Bytes(bytes), value };
}

module.exports = {
  APP_CLOSE_SEAL_FILENAME,
  pairOutputObservations,
  readCompetitionAppCloseSeal,
  writeCompetitionAppCloseSeal,
};
