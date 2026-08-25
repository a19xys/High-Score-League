const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const yazl = require("yazl");
const packageMetadata = require("../package.json");
const { readMameRuntimeManifest } = require("../src/mame-runtime-manifest");
const { loadPackFromDir } = require("../src/pack");
const { writeCompetitionManifest } = require("../src/competition-manifest");

const EXPECTED_HSL_ORIGIN = "https://highscoreleague.com";
const EXACT_REVISION_ARTIFACT = "C:\\Users\\u\\AppData\\Local\\Temp\\hsl-competition-e2e-b16fa91c1bdf47c290a76c243fec965c\\space-invaders-s1-w1-r2.hslpack.zip";
const EXACT_REVISION_FIXTURE = Object.freeze({
  artifactSha256: "181e0f344087f3511d4826b93b9ed45510b205eccdb014370042b42b1de3cb69",
  artifactSizeBytes: 37130293,
  competitionManifestSha256: "782a2ca4b8a818dd44ec6279951022c9e6c804b5e7051877d6a762753bd02d53",
  targetPackId: "space-invaders-s1-w1-r2",
});

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => fs.createReadStream(filePath)
    .on("data", (chunk) => hash.update(chunk))
    .on("end", resolve)
    .on("error", reject));
  return hash.digest("hex");
}

async function zipDirectory(sourceDir, zipPath) {
  const zip = new yazl.ZipFile();
  async function add(current, relative = "") {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const sourcePath = path.join(current, entry.name);
      const archivePath = path.posix.join("Packaged Revision", relative, entry.name);
      if (entry.isDirectory()) await add(sourcePath, path.posix.join(relative, entry.name));
      else zip.addFile(sourcePath, archivePath);
    }
  }
  await add(sourceDir);
  await new Promise((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}

async function createSyntheticRevisionFixture(tempDir) {
  const targetPackId = "packaged-revision-target";
  const sourceDir = path.join(tempDir, "revision-fixture-source");
  await Promise.all([
    fsp.mkdir(path.join(sourceDir, "roms"), { recursive: true }),
    fsp.mkdir(path.join(sourceDir, "scripts"), { recursive: true }),
  ]);
  await fsp.writeFile(path.join(sourceDir, "roms", "game.zip"), "packaged-qa-rom");
  await fsp.writeFile(path.join(sourceDir, "scripts", "capture.lua"), "return { observe_capture = function() end }");
  await fsp.writeFile(path.join(sourceDir, "pack.json"), `${JSON.stringify({
    packVersion: 2,
    packId: targetPackId,
    gameId: "packaged-revision-game",
    rom: "game",
    seasonId: "packaged-season",
    seasonSlug: "packaged-season",
    seasonName: "Packaged Season",
    weekId: "packaged-week",
    weekNumber: 1,
    webBaseUrl: EXPECTED_HSL_ORIGIN,
    runtime: { type: "mame", minVersion: "0.287", recommendedVersion: "0.287" },
    mame: {
      romPath: "roms",
      launchArgs: [],
      profiles: {
        practice: { launchArgs: [] },
        competition: { launchArgs: [], integrity: { version: 1, mameVersion: "0.287", dips: [] } },
      },
    },
    capture: {
      mode: "plugin",
      pluginName: "hsl-score",
      adapter: "scripts/capture.lua",
      automatic: { version: 1, strategy: "fixture-v1" },
    },
  }, null, 2)}\n`);
  const loaded = loadPackFromDir(sourceDir);
  if (!loaded.loaded || loaded.errors?.length > 0) throw new Error("No se pudo construir la fixture sintética de revisión.");
  const manifest = await writeCompetitionManifest(loaded.pack);
  const artifactPath = path.join(tempDir, "packaged-revision-target.hslpack.zip");
  await zipDirectory(sourceDir, artifactPath);
  const stat = await fsp.stat(artifactPath);
  return {
    artifactPath,
    artifactSha256: await sha256File(artifactPath),
    artifactSizeBytes: stat.size,
    competitionManifestSha256: manifest.manifestSha256,
    targetPackId,
  };
}

async function resolveRevisionFixture(tempDir, explicitPath = null) {
  const requested = explicitPath || process.env.HSL_PACK_REVISION_QA_ARTIFACT || EXACT_REVISION_ARTIFACT;
  try {
    await fsp.access(requested);
    if (path.resolve(requested) === path.resolve(EXACT_REVISION_ARTIFACT)) {
      return { artifactPath: requested, ...EXACT_REVISION_FIXTURE };
    }
    const metadata = process.env.HSL_PACK_REVISION_QA_METADATA
      ? JSON.parse(process.env.HSL_PACK_REVISION_QA_METADATA)
      : null;
    if (!metadata) throw new Error("La fixture explícita requiere HSL_PACK_REVISION_QA_METADATA.");
    return { artifactPath: requested, ...metadata };
  } catch (error) {
    if (explicitPath || process.env.HSL_PACK_REVISION_QA_ARTIFACT) throw error;
    return createSyntheticRevisionFixture(tempDir);
  }
}

async function waitForFile(filePath, timeoutMs = 120_000, child = null, output = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return JSON.parse(await fsp.readFile(filePath, "utf8"));
    if (child?.exitCode !== null) {
      throw new Error(`La app empaquetada termino antes de readiness (exit ${child.exitCode}). ${output?.() || ""}`.trim());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`La app empaquetada no emitio readiness en ${timeoutMs} ms.`);
}

async function smokePackaged(options = {}) {
  if (process.platform !== "win32") throw new Error("El smoke empaquetado requiere Windows.");
  const appDir = path.resolve(__dirname, "..");
  const unpackedDir = options.unpackedDir || path.join(appDir, "dist", "win-unpacked");
  const executablePath = path.join(unpackedDir, "High Score League.exe");
  const resourcesPath = path.join(unpackedDir, "resources");
  const manifest = readMameRuntimeManifest();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-packaged-smoke-"));
  const reportPath = path.join(tempDir, "readiness.json");
  const revisionFixture = await resolveRevisionFixture(tempDir, options.revisionArtifactPath);
  await fsp.access(executablePath);
  await fsp.access(path.join(resourcesPath, "mame", manifest.version, "mame.exe"));
  await fsp.access(path.join(resourcesPath, "hsl", "mame-plugin", "hsl-score", "init.lua"));
  let diagnosticOutput = "";
  const child = spawn(executablePath, [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--in-process-gpu",
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      HSL_PACKAGED_SMOKE_FILE: reportPath,
      HSL_PACK_REVISION_QA_ARTIFACT: revisionFixture.artifactPath,
      HSL_PACK_REVISION_QA_MANIFEST_SHA256: revisionFixture.competitionManifestSha256,
      HSL_PACK_REVISION_QA_PACK_ID: revisionFixture.targetPackId,
      HSL_PACK_REVISION_QA_SHA256: revisionFixture.artifactSha256,
      HSL_PACK_REVISION_QA_SIZE: String(revisionFixture.artifactSizeBytes),
      HSL_USER_DATA_DIR: path.join(tempDir, "userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const collect = (chunk) => { diagnosticOutput = `${diagnosticOutput}${String(chunk)}`.slice(-4000); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  try {
    const report = await waitForFile(reportPath, options.timeoutMs, child, () => diagnosticOutput);
    if (!report.isPackaged || report.version !== packageMetadata.version || report.productName !== "High Score League") {
      throw new Error(`Readiness empaquetada invalida: ${JSON.stringify(report)}`);
    }
    if (!report.mame?.available || report.mame.version !== manifest.version || !report.productConfigAvailable || !report.pluginAvailable) {
      throw new Error(`Recursos empaquetados incompletos: ${JSON.stringify(report)}`);
    }
    if (
      report.effectiveHslOrigin !== EXPECTED_HSL_ORIGIN
      || report.productConfigSource !== "product-metadata"
      || report.remoteConfigurationSource !== "launcher-config"
    ) {
      throw new Error(`Autoridad HSL empaquetada invalida: ${JSON.stringify(report)}`);
    }
    if (report.windowsUpdate?.enabled !== false || report.windowsUpdate?.enableReason !== "packaged-smoke") {
      throw new Error(`El updater no quedo aislado durante smoke: ${JSON.stringify(report.windowsUpdate)}`);
    }
    if (!report.userDataIsolation?.overrideActive || !report.userDataIsolation.electronProfileIsolated
        || !report.userDataIsolation.rootsDiffer || !report.userDataIsolation.hslRootMatchesOverride
        || !report.userDataIsolation.configUsesHslRoot) {
      throw new Error(`El root HSL no quedo aislado del perfil Electron: ${JSON.stringify(report.userDataIsolation)}`);
    }
    const integrityQa = report.packagedIntegrityQa;
    if (!integrityQa?.ok || !integrityQa.appPathContainsAsar || !integrityQa.productRootResolved
        || !integrityQa.verifyRunInputsPassed || !integrityQa.monitorStarted || !integrityQa.postRunVerified
        || integrityQa.virtualAsarPathWatched || !integrityQa.asarContainerWatched) {
      throw new Error(`QA de integridad app.asar invalida: ${JSON.stringify(integrityQa)}`);
    }
    const revisionQa = integrityQa.revisionQa;
    if (!revisionQa?.ok || revisionQa.oldRevisionStatus !== "outdated"
        || revisionQa.targetRevisionStatus !== "current" || !revisionQa.uniqueVisibleTarget
        || !revisionQa.finalPackDirPreserved || !revisionQa.provenanceVerified
        || revisionQa.practiceBefore !== true || revisionQa.competitionBefore !== false
        || revisionQa.practiceAfter !== true || revisionQa.competitionAfter !== true) {
      throw new Error(`QA empaquetada de revisión inválida: ${JSON.stringify(revisionQa)}`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await fsp.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (require.main === module) {
  smokePackaged().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_HSL_ORIGIN, smokePackaged, waitForFile };
