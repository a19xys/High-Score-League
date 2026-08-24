const fsp = require("node:fs/promises");
const path = require("node:path");
const { getRepoPluginDir } = require("./dev-sync-plugin");
const { getProductRuntime } = require("./product-runtime");
const {
  buildRunInputManifest,
  createRunInputMonitor,
  verifyRunInputs,
  verifyRunInputsAfterClose,
  writePreparedMarker,
} = require("./run-input-integrity");

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
      virtualAsarPathWatched: verified.monitoredPaths.some((item) => path.resolve(item) === resolvedProductRootPath),
      asarContainerWatched: Boolean(asarContainer && verified.monitoredPaths.some((item) => path.resolve(item) === path.resolve(asarContainer))),
      verifyRunInputsPassed: true,
    };
  } finally {
    await fsp.rm(runRoot, { recursive: true, force: true });
  }
}

module.exports = { runPackagedIntegrityQa };
