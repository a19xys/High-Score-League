const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { setPackDirectory } = require("./pack-directory");
const { loadPackFromDir } = require("./pack");
const { scanPackLibrary } = require("./pack-library");
const { writeCompetitionManifest } = require("./competition-manifest");
const { deriveCompetitionAccess } = require("./competition-access");
const { derivePackRevisionStatus } = require("./pack-revision-status");
const { readPackProvenanceReceipt } = require("./pack-provenance");
const { stagePackZipForUpdate } = require("./pack-importer");
const { executeRemotePackUpdate } = require("./remote-pack-update");
const { getRepoPluginDir } = require("./dev-sync-plugin");
const { getProductRuntime } = require("./product-runtime");
const {
  buildRunInputManifest,
  createRunInputMonitor,
  verifyRunInputs,
  verifyRunInputsAfterClose,
  writePreparedMarker,
} = require("./run-input-integrity");

function packagedRevisionFixture() {
  const artifactPath = process.env.HSL_PACK_REVISION_QA_ARTIFACT;
  const artifactSizeBytes = Number(process.env.HSL_PACK_REVISION_QA_SIZE);
  const artifactSha256 = process.env.HSL_PACK_REVISION_QA_SHA256;
  const competitionManifestSha256 = process.env.HSL_PACK_REVISION_QA_MANIFEST_SHA256;
  const targetPackId = process.env.HSL_PACK_REVISION_QA_PACK_ID;
  if (!artifactPath || !Number.isSafeInteger(artifactSizeBytes) || artifactSizeBytes <= 0
      || !/^[0-9a-f]{64}$/.test(artifactSha256 || "")
      || !/^[0-9a-f]{64}$/.test(competitionManifestSha256 || "")
      || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(targetPackId || "")) {
    throw new Error("La fixture empaquetada de revisión no está configurada correctamente.");
  }
  return {
    artifactPath: path.resolve(artifactPath),
    artifactSha256,
    artifactSizeBytes,
    competitionManifestSha256,
    targetPackId,
  };
}

function readyLocalRevision(revision) {
  return deriveCompetitionAccess({
    local: {
      canPractice: true,
      canSubmitLocally: true,
      captureReady: true,
      hasCompetitionScope: true,
      hasWeek: true,
      protectedCompetitionReady: true,
      revisionManaged: true,
      revisionStatus: revision.status,
    },
    membership: { canSubmit: true, status: "member" },
    session: { hasSession: true, remoteUsable: true, requiresLogin: false, userId: "packaged-qa-player" },
    week: { publicState: "active" },
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

async function runPackagedRevisionQa(config, runRoot) {
  const fixture = packagedRevisionFixture();
  const stat = await fsp.stat(fixture.artifactPath);
  if (!stat.isFile() || stat.size !== fixture.artifactSizeBytes
      || await sha256File(fixture.artifactPath) !== fixture.artifactSha256) {
    throw new Error("El artifact de revisión empaquetado no conserva size/SHA esperados.");
  }
  const revisionRoot = path.join(runRoot, "pack-revision");
  const sourceDir = path.join(revisionRoot, "target-source");
  const libraryRoot = path.join(revisionRoot, "library");
  const finalDir = path.join(libraryRoot, "Installed Game");
  const qaConfig = { ...config, userDataDir: path.join(revisionRoot, "user-data") };
  await fsp.mkdir(libraryRoot, { recursive: true });
  const stagedSource = await stagePackZipForUpdate(fixture.artifactPath, sourceDir, {
    expectedPackId: fixture.targetPackId,
  });
  if (stagedSource.manifest.manifestSha256 !== fixture.competitionManifestSha256) {
    throw new Error("El manifest del target empaquetado no coincide con la fixture declarada.");
  }
  const oldPackId = fixture.targetPackId === "space-invaders-s1-w1-r2"
    ? "space-invaders-s1-w1-r1"
    : "packaged-revision-previous";
  await fsp.cp(sourceDir, finalDir, { recursive: true, errorOnExist: true, force: false });
  const oldJsonPath = path.join(finalDir, "pack.json");
  const oldJson = JSON.parse(await fsp.readFile(oldJsonPath, "utf8"));
  oldJson.packId = oldPackId;
  await fsp.writeFile(oldJsonPath, `${JSON.stringify(oldJson, null, 2)}\n`, "utf8");
  const loadedOld = loadPackFromDir(finalDir);
  if (!loadedOld.loaded || loadedOld.errors?.length > 0) throw new Error("No se pudo preparar la revisión old de QA.");
  await writeCompetitionManifest(loadedOld.pack);
  await setPackDirectory(qaConfig, libraryRoot);

  const before = await scanPackLibrary(qaConfig);
  const oldRevision = derivePackRevisionStatus({
    authorityConfirmed: true,
    capability: { publishedPackId: fixture.targetPackId },
    localPackId: oldPackId,
    revisionManaged: true,
  });
  const oldAccess = readyLocalRevision(oldRevision);
  if (before.packs.length !== 1 || oldRevision.status !== "outdated"
      || oldAccess.canPractice !== true || oldAccess.canPlayCompetition !== false) {
    throw new Error("La QA empaquetada no reprodujo old instalado → update disponible.");
  }

  let bookkeepingRuns = 0;
  const updated = await executeRemotePackUpdate({
    cleanupDownloadedArtifactImpl: async () => {},
    config: qaConfig,
    downloadPackArtifactImpl: async () => ({
      bytes: fixture.artifactSizeBytes,
      filePath: fixture.artifactPath,
      tempDir: null,
    }),
    ensureFreshCapability: async () => ({ ok: true, capability: { publishedPackId: fixture.targetPackId } }),
    isOperationBlocked: async () => false,
    oldPack: {
      gameId: loadedOld.pack.gameId,
      packDir: finalDir,
      packId: oldPackId,
      weekId: loadedOld.pack.weekId,
    },
    onBookkeeping: async () => { bookkeepingRuns += 1; },
    requestPackDescriptorImpl: async () => ({
      status: "ready",
      descriptor: {
        artifact: { sha256: fixture.artifactSha256, sizeBytes: fixture.artifactSizeBytes },
        packId: fixture.targetPackId,
        version: 1,
      },
    }),
    targetPackId: fixture.targetPackId,
  });
  if (updated.status !== "updated" || path.resolve(updated.packDir) !== path.resolve(finalDir)) {
    throw new Error("El replacement empaquetado no conservó el final packDir.");
  }
  const after = await scanPackLibrary(qaConfig);
  const installed = after.packs[0];
  const receipt = readPackProvenanceReceipt(qaConfig, fixture.targetPackId, {
    artifactSha256: fixture.artifactSha256,
    artifactSizeBytes: fixture.artifactSizeBytes,
    competitionManifestSha256: fixture.competitionManifestSha256,
  });
  const currentRevision = derivePackRevisionStatus({
    authorityConfirmed: true,
    capability: { publishedPackId: fixture.targetPackId },
    localPackId: installed?.packId,
    provenanceVerified: receipt.ok,
    revisionManaged: true,
  });
  const currentAccess = readyLocalRevision(currentRevision);
  if (after.packs.length !== 1 || installed?.packId !== fixture.targetPackId || !receipt.ok
      || currentRevision.status !== "current" || currentAccess.canPractice !== true
      || currentAccess.canPlayCompetition !== true || bookkeepingRuns !== 1) {
    throw new Error("La QA empaquetada no convergió a target único, verificado y competitivo.");
  }
  return {
    artifactSha256: fixture.artifactSha256,
    artifactSizeBytes: fixture.artifactSizeBytes,
    bookkeepingRuns,
    competitionAfter: currentAccess.canPlayCompetition,
    competitionBefore: oldAccess.canPlayCompetition,
    exactProductionArtifact: fixture.targetPackId === "space-invaders-s1-w1-r2"
      && fixture.artifactSizeBytes === 37130293
      && fixture.artifactSha256 === "181e0f344087f3511d4826b93b9ed45510b205eccdb014370042b42b1de3cb69"
      && fixture.competitionManifestSha256 === "782a2ca4b8a818dd44ec6279951022c9e6c804b5e7051877d6a762753bd02d53",
    finalPackDirPreserved: path.resolve(updated.packDir) === path.resolve(finalDir),
    oldPackId,
    oldRevisionStatus: oldRevision.status,
    ok: true,
    practiceAfter: currentAccess.canPractice,
    practiceBefore: oldAccess.canPractice,
    provenanceVerified: receipt.ok,
    targetPackId: fixture.targetPackId,
    targetRevisionStatus: currentRevision.status,
    uniqueVisibleTarget: after.packs.length === 1 && installed?.packId === fixture.targetPackId,
  };
}

async function runPackagedIntegrityQa(config, options = {}) {
  const productRuntime = options.productRuntime || getProductRuntime();
  if (productRuntime.isPackaged !== true || !productRuntime.appPath || !productRuntime.userDataDir) {
    throw new Error("La QA de integridad empaquetada requiere el contexto real de una app packaged.");
  }
  if (config.sharedMameRuntime?.source !== "bundled") {
    throw new Error("La QA de integridad empaquetada requiere el runtime MAME bundled.");
  }
  const runId = "packaged_integrity_qa";
  const runRoot = path.join(productRuntime.userDataDir, "packaged-integrity-qa", runId);
  const integrityDir = path.join(runRoot, "integrity");
  const productRootPath = path.join(productRuntime.appPath, "product", "product-integrity-root.json");
  const pluginSourceDir = getRepoPluginDir(config.appDir, { productRuntime });
  const mameRuntimeRoot = config.sharedMameRuntime.runtimeRoot
    || path.dirname(config.sharedMameRuntime.mameExecutablePath);
  const run = {
    runId,
    runRoot,
    integrityDir,
    createdAt: options.nowIso || new Date().toISOString(),
    config: { sharedMameRuntime: config.sharedMameRuntime },
    sharedMameRuntime: config.sharedMameRuntime,
    pluginSourceDir,
    mameRuntimeRoot,
    integrity: {
      packId: "packaged-integrity-qa",
      manifestSha256: "0".repeat(64),
      mameVersion: config.sharedMameRuntime.version,
      pluginVersion: "0.4.0",
    },
  };
  await fsp.rm(runRoot, { recursive: true, force: true });
  await Promise.all([
    fsp.mkdir(path.join(integrityDir, "app"), { recursive: true }),
    fsp.mkdir(path.join(runRoot, "immutable"), { recursive: true }),
  ]);
  try {
    const fixturePath = path.join(runRoot, "immutable", "packaged-qa-input.txt");
    await fsp.writeFile(fixturePath, "packaged-integrity-qa\n", { encoding: "utf8", flag: "wx" });
    const launchPlan = {
      version: 1,
      command: config.sharedMameRuntime.mameExecutablePath,
      args: ["packaged-integrity-qa"],
      cwd: runRoot,
      environmentOverrides: {},
      mode: "competition",
      rom: "packaged-integrity-qa",
      pluginName: "hsl-score",
      runtime: "pack-v2-shared",
      mutableDirectories: {},
    };
    run.launchPlan = launchPlan;
    const built = await buildRunInputManifest(run, [{ filePath: fixturePath, role: "packaged_qa_fixture" }], launchPlan, {
      productRootPath,
      productRuntime,
    });
    run.runInputManifestSha256 = built.sha256;
    await writePreparedMarker(run, { nowIso: run.createdAt });
    const verified = await verifyRunInputs(run, { productRootPath, productRuntime });
    const monitor = await createRunInputMonitor(run, verified);
    const monitorState = await monitor.close();
    const postVerified = await verifyRunInputsAfterClose(run, { monitor, productRootPath, productRuntime });
    if (!postVerified || monitorState.violations.length > 0) {
      throw new Error("El monitor empaquetado no pudo conservar una frontera limpia.");
    }
    const resolvedAppPath = path.resolve(productRuntime.appPath);
    const resolvedProductRootPath = path.resolve(productRootPath);
    const asarContainer = /^(.*?\.asar)(?:[\\/].*)$/i.exec(resolvedProductRootPath)?.[1] || null;
    const revisionQa = await runPackagedRevisionQa(config, runRoot);
    return {
      appPath: resolvedAppPath,
      appPathContainsAsar: /(?:^|[\\/])[^\\/]+\.asar$/i.test(resolvedAppPath),
      mameSpawned: false,
      monitorStarted: true,
      monitoredPaths: verified.monitoredPaths,
      ok: true,
      postRunVerified: true,
      productRootPath: resolvedProductRootPath,
      productRootResolved: true,
      revisionQa,
      virtualAsarPathWatched: verified.monitoredPaths.some((item) => path.resolve(item) === resolvedProductRootPath),
      asarContainerWatched: Boolean(asarContainer && verified.monitoredPaths.some((item) => path.resolve(item) === path.resolve(asarContainer))),
      verifyRunInputsPassed: true,
    };
  } finally {
    await fsp.rm(runRoot, { recursive: true, force: true });
  }
}

module.exports = { runPackagedIntegrityQa, runPackagedRevisionQa };
