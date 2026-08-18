const fsp = require("node:fs/promises");
const path = require("node:path");
const packageMetadata = require("../package.json");
const {
  createGitHubClient,
  findDraftAndProvenance,
  publishWindowsRelease,
  remotePreflight,
  stageWindowsRelease,
  validatePrivilegedWorkflowIdentity,
} = require("./lib/windows-release-github");

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  await fsp.appendFile(outputPath, `${lines}\n`, "utf8");
}

async function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) await fsp.appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");
}

async function main() {
  const command = process.argv[2];
  const version = readOption("version", process.env.HSL_RELEASE_VERSION);
  const sourceCommit = readOption("source-commit", process.env.GITHUB_SHA);
  const workflowRef = process.env.GITHUB_REF;
  const sourceRef = readOption("source-ref", workflowRef);
  const workflowRepository = process.env.GITHUB_REPOSITORY;
  const bundleDir = path.resolve(readOption("bundle-dir", path.join(__dirname, "..", "release-bundle")));

  if (command === "locate" || command === "publish") {
    validatePrivilegedWorkflowIdentity({ workflowRepository, workflowRef });
  }

  const client = createGitHubClient({ token: process.env.GITHUB_TOKEN });

  if (command === "preflight") {
    await remotePreflight(client, {
      version,
      packageVersion: packageMetadata.version,
      workflowRepository,
      sourceRef,
      sourceCommit,
      requireCurrentHead: true,
    });
    await writeSummary(`- Preflight remoto de \`${version}\`: correcto; repositorio, master, commit, SemVer e historial verificados.`);
    return;
  }
  if (command === "stage") {
    const mode = readOption("mode", process.env.HSL_RELEASE_MODE);
    const result = await stageWindowsRelease({
      client,
      mode,
      version,
      packageVersion: packageMetadata.version,
      workflowRepository,
      sourceRef,
      sourceCommit,
      bundleDir,
      notes: readOption("notes", process.env.HSL_RELEASE_NOTES),
      stageRunId: Number(readOption("stage-run-id", process.env.GITHUB_RUN_ID)),
      artifactId: Number(readOption("artifact-id", process.env.HSL_ARTIFACT_ID)),
      artifactName: readOption("artifact-name", process.env.HSL_ARTIFACT_NAME),
      artifactDigest: readOption("artifact-digest", process.env.HSL_ARTIFACT_DIGEST),
    });
    await writeSummary(result.mode === "dry-run"
      ? `- Dry-run de \`${version}\`: ninguna Release, tag ni asset de Release fue mutado.`
      : `- Draft \`${result.provenance.tag}\` validado y conservado como draft (Release ID ${result.release.id}).`);
    return;
  }
  if (command === "locate") {
    const located = await findDraftAndProvenance(client, version, readOption("confirmation", process.env.HSL_RELEASE_CONFIRMATION));
    await writeOutputs({
      "artifact-id": located.provenance.artifactId,
      "artifact-name": located.provenance.artifactName,
      "artifact-digest": located.provenance.artifactDigest,
      "stage-run-id": located.provenance.stageRunId,
      "source-commit": located.provenance.sourceCommit,
      "source-ref": located.provenance.sourceRef,
      "release-id": located.draft.id,
    });
    await writeSummary(`- Provenance de \`${located.provenance.tag}\`: Stage run ${located.provenance.stageRunId}, artifact ${located.provenance.artifactId}.`);
    return;
  }
  if (command === "publish") {
    const result = await publishWindowsRelease({
      client,
      version,
      confirmation: readOption("confirmation", process.env.HSL_RELEASE_CONFIRMATION),
      bundleDir,
    });
    await writeSummary(`- Release estable \`${result.provenance.tag}\` publicada y verificada como latest; tag y ${result.bundle.assets.length} assets coinciden con el commit \`${result.provenance.sourceCommit}\`.`);
    return;
  }
  throw new Error("Comando requerido: preflight, stage, locate o publish.");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Pipeline GitHub fallida: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, readOption, writeOutputs, writeSummary };
