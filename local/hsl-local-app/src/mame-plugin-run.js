const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { getRepoPluginDir, listPluginFilesToCopy } = require("./dev-sync-plugin");
const { isUnsafePackRelativePath } = require("./pack-contract");
const { sha256 } = require("./competition-manifest");
const { createVerifiedCompetitionSnapshot } = require("./competition-snapshot");
const {
  COMPETITION_CONTROLLER_NAME,
  buildCompetitionControllerProfile,
} = require("./mame-controller-profile");
const { validatePackMameArguments } = require("./mame-arguments");
const { compareMameVersions, detectMameVersion } = require("./mame-version");
const {
  developerOverrideProvenance,
  readPackProvenanceReceipt,
  remoteVerifiedProvenance,
} = require("./pack-provenance");
const { getProductRuntime } = require("./product-runtime");
const {
  PRODUCT_PLUGIN_INTEGRITY_FILENAME,
  PRODUCT_RUNTIME_INTEGRITY_FILENAME,
  readPluginVersion,
  sha256File,
  verifyBundledMameRuntimeIntegrity,
  verifyBundledPluginIntegrity,
} = require("./product-runtime-integrity");

const DEFAULT_PLUGIN_NAME = "hsl-score";

function isPackV2Config(config = {}) {
  return config.pack?.packVersion === 2 || config.pack?.contract?.version === 2;
}

function isSafePluginName(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value);
}

function pathInside(childPath, rootPath) {
  if (!childPath || !rootPath) {
    return false;
  }

  const relative = path.relative(path.resolve(rootPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getCaptureContract(config = {}) {
  return config.pack?.contract?.capture || {};
}

function resolveAdapterPath(config = {}) {
  const capture = getCaptureContract(config);
  const adapter = capture.adapter;
  const packRoot = config.pack?.packRoot || config.packRoot;

  if (!adapter || !packRoot) {
    return capture.adapterPath || null;
  }

  return capture.adapterPath || path.resolve(packRoot, adapter);
}

function resolveSelectedMameRuntimeRoot(config = {}) {
  const runtime = config.sharedMameRuntime || {};

  if (typeof runtime.runtimeRoot === "string" && runtime.runtimeRoot.trim()) {
    return runtime.runtimeRoot.trim();
  }

  if (typeof runtime.mameExecutablePath === "string" && runtime.mameExecutablePath.trim()) {
    return path.dirname(runtime.mameExecutablePath.trim());
  }

  return null;
}

function resolvePluginBootstrapSourcePath(config = {}) {
  const runtimeRoot = resolveSelectedMameRuntimeRoot(config);
  return runtimeRoot ? path.join(runtimeRoot, "plugins", "boot.lua") : null;
}

function readManifestSha256(packRoot) {
  try {
    return sha256(fs.readFileSync(path.join(packRoot, "competition-manifest.json")));
  } catch {
    return null;
  }
}

function resolveCompetitionProvenance(config, pack, manifestSha256, options = {}) {
  const developerOverride = options.developerOverride === true && getProductRuntime().isPackaged !== true;
  if (developerOverride) {
    return {
      errors: [],
      mode: "developer_override",
      ok: true,
      provenance: developerOverrideProvenance(manifestSha256),
      receiptPath: null,
    };
  }
  const receipt = readPackProvenanceReceipt(config, pack?.packId, {
    competitionManifestSha256: manifestSha256,
  });
  return {
    errors: receipt.errors,
    mode: receipt.ok ? "remote_verified" : "unverified",
    ok: receipt.ok,
    provenance: receipt.ok ? remoteVerifiedProvenance(receipt.receipt) : null,
    receiptPath: receipt.receiptPath,
  };
}

function getV2CaptureReadiness(config = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const capture = getCaptureContract(config);
  const packRoot = config.pack?.packRoot || config.packRoot;
  const pluginName = capture.pluginName || DEFAULT_PLUGIN_NAME;
  const adapterPath = resolveAdapterPath(config);
  const sourceDir = options.sourceDir || getRepoPluginDir(config.appDir);

  if (!isPackV2Config(config)) {
    errors.push("El cargador competitivo aislado solo aplica a packVersion 2.");
  }

  if (capture.mode !== "plugin") {
    errors.push("capture.mode debe ser plugin para competicion v2.");
  }

  if (!isSafePluginName(pluginName)) {
    errors.push("capture.pluginName contiene caracteres no permitidos.");
  } else if (pluginName !== DEFAULT_PLUGIN_NAME) {
    errors.push(`capture.pluginName debe ser ${DEFAULT_PLUGIN_NAME} en esta version.`);
  }

  if (!capture.adapter) {
    errors.push("capture.adapter no definido.");
  } else if (isUnsafePackRelativePath(capture.adapter)) {
    errors.push("capture.adapter debe ser una ruta relativa segura dentro del pack.");
  }

  if (!packRoot) {
    errors.push("No se pudo resolver la carpeta raiz del pack.");
  }

  if (adapterPath && packRoot && !pathInside(adapterPath, packRoot)) {
    errors.push("capture.adapter resuelve fuera de la carpeta del pack.");
  }

  if (!adapterPath) {
    errors.push("No se pudo resolver capture.adapter.");
  } else if (!fs.existsSync(adapterPath) || !fs.statSync(adapterPath).isFile()) {
    errors.push("capture.adapter no existe o no es un archivo.");
  }

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    errors.push("No se encontro el plugin HSL controlado por la app.");
  }

  return {
    adapter: capture.adapter || null,
    adapterPath,
    errors,
    ok: errors.length === 0,
    pluginName,
    sourceDir,
    warnings,
  };
}

function getV2CompetitionReadiness(config = {}, options = {}) {
  const captureReadiness = getV2CaptureReadiness(config, options);
  const errors = [...captureReadiness.errors];
  const integrity = config.pack?.contract?.mame?.profiles?.competition?.integrity || null;
  let pluginVersion = null;

  try {
    pluginVersion = readPluginVersion(captureReadiness.sourceDir);
    if (pluginVersion !== "0.3.0") errors.push(`Competicion protegida requiere hsl-score 0.3.0 exacto; se encontro ${pluginVersion}.`);
  } catch (error) {
    errors.push(`No se pudo acreditar la version del plugin HSL: ${error.message}`);
  }

  if (!integrity || integrity.version !== 1) {
    errors.push("Este pack no esta preparado para Competicion protegida: falta integrity v1.");
  } else {
    const automatic = config.pack?.contract?.capture?.automatic;
    if (!automatic || automatic.version !== 1 || !automatic.strategy) {
      errors.push("Este pack no declara una estrategia de captura automatica compatible con Competicion protegida.");
    }
    if (config.sharedMameRuntime?.version) {
      try {
        if (compareMameVersions(config.sharedMameRuntime.version, integrity.mameVersion) !== 0) {
          errors.push(`Competicion protegida requiere MAME ${integrity.mameVersion} exacto; se encontro ${config.sharedMameRuntime.version}.`);
        }
      } catch {
        errors.push("No se pudo interpretar la version MAME requerida o configurada para Competicion protegida.");
      }
    }
    for (const [args, label] of [
      [config.pack?.contract?.mame?.launchArgs, "mame.launchArgs"],
      [config.pack?.contract?.mame?.profiles?.competition?.launchArgs, "mame.profiles.competition.launchArgs"],
    ]) {
      try { validatePackMameArguments(args, label, { mode: "competition" }); }
      catch (error) { errors.push(error.message); }
    }

    const mame = config.pack?.contract?.mame || {};
    const competitionSeed = mame.profiles?.competition?.cfgDir;
    const practiceCfg = mame.profiles?.practice?.cfgDir || mame.cfgDir;
    if (competitionSeed && practiceCfg && path.resolve(competitionSeed).toLowerCase() === path.resolve(practiceCfg).toLowerCase()) {
      errors.push("El cfg seed de Competicion no puede ser la misma carpeta mutable usada por Practica.");
    }

    const manifestSha256 = readManifestSha256(config.pack?.packRoot || config.packRoot);
    if (!manifestSha256) errors.push("No se encontro competition-manifest.json para Competicion protegida.");
    const provenance = manifestSha256
      ? resolveCompetitionProvenance(config, config.pack, manifestSha256, options)
      : { errors: [], mode: "unverified", ok: false, provenance: null, receiptPath: null };
    if (!provenance.ok) errors.push(...provenance.errors);
    if (config.sharedMameRuntime?.source !== "bundled" && provenance.mode !== "developer_override") {
      errors.push("Competicion protegida con MAME externo requiere la autoridad existente de Developer Tools.");
    }
    if (config.sharedMameRuntime?.source === "bundled") {
      if (!fs.existsSync(path.join(resolveSelectedMameRuntimeRoot(config) || "", PRODUCT_RUNTIME_INTEGRITY_FILENAME))) {
        errors.push("El runtime MAME bundled no contiene su manifest de bytes criticos.");
      }
      if (!fs.existsSync(path.join(captureReadiness.sourceDir, PRODUCT_PLUGIN_INTEGRITY_FILENAME))) {
        errors.push("El plugin HSL bundled no contiene su manifest de bytes criticos.");
      }
    }
    return {
      ...captureReadiness,
      automatic,
      errors,
      integrity,
      manifestSha256,
      ok: errors.length === 0,
      pluginVersion,
      provenance,
    };
  }

  return {
    ...captureReadiness,
    errors,
    ok: errors.length === 0,
    integrity,
    pluginVersion,
  };
}

function createRunId(options = {}) {
  if (options.runId) {
    return String(options.runId);
  }

  const timestamp = (options.now || new Date()).toISOString().replace(/[:.]/g, "-");
  return `run_${timestamp}_${crypto.randomBytes(4).toString("hex")}`;
}

function toLuaString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`)}"`;
}

function buildRunConfigLua(run) {
  const dips = run.integrity.dips.map((dip) => (
    `      { portTag = ${toLuaString(dip.portTag)}, mask = ${dip.mask}, value = ${dip.value} },`
  ));
  return [
    "return {",
    `  outputDir = ${toLuaString(run.stagingCandidatesDir)},`,
    '  gameModule = "games/adapter.lua",',
    `  hslRunId = ${toLuaString(run.runId)},`,
    `  automaticCaptureStrategy = ${toLuaString(run.automaticCaptureStrategy)},`,
    "  competitionIntegrity = {",
    "    version = 1,",
    "    guardVersion = 1,",
    `    runId = ${toLuaString(run.runId)},`,
    `    packId = ${toLuaString(run.integrity.packId)},`,
    `    manifestSha256 = ${toLuaString(run.integrity.manifestSha256)},`,
    `    mameVersion = ${toLuaString(run.integrity.mameVersion)},`,
    `    integrityDir = ${toLuaString(run.integrityDir)},`,
    "    dips = {",
    ...dips,
    "    }",
    "  },",
    "  enableFrameTracking = true,",
    "  trackingIntervalFrames = 5,",
    "  debugEvent = false",
    "}",
    "",
  ].join("\n");
}

async function copyCfgSeed(sourceDir, targetDir) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const stat = await fsp.lstat(sourcePath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`El cfg seed competitivo contiene una entrada no permitida: ${entry.name}`);
    }
    if (stat.isDirectory()) {
      await fsp.mkdir(targetPath, { recursive: true });
      await copyCfgSeed(sourcePath, targetPath);
    } else {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

async function copyPluginSource(sourceDir, pluginDir) {
  const files = await listPluginFilesToCopy(sourceDir);

  await fsp.mkdir(pluginDir, { recursive: true });

  for (const relativePath of files) {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(pluginDir, relativePath);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, targetPath);
  }

  return files;
}


async function prepareV2CompetitionRun(config = {}, scope = {}, options = {}) {
  if (!config.userDataDir) throw new Error("No se pudo resolver userDataDir para preparar competicion v2.");
  if (!scope?.scopedQueueRoot || !scope?.playerKey || !scope?.packKey) {
    throw new Error("No se pudo resolver la cola scoped de cuenta y pack.");
  }

  const readiness = getV2CompetitionReadiness(config, options);
  if (!readiness.ok) throw new Error(`No se puede preparar competicion v2: ${readiness.errors.join(" ")}`);

  const expectedMameVersion = readiness.integrity.mameVersion;
  const observedMameVersion = await Promise.resolve(
    (options.detectMameVersionImpl || detectMameVersion)(config.sharedMameRuntime.mameExecutablePath),
  );
  if (compareMameVersions(observedMameVersion, expectedMameVersion) !== 0) {
    throw new Error(`Competicion protegida requiere MAME ${expectedMameVersion} exacto; se encontro ${observedMameVersion}.`);
  }
  const mameRuntimeRoot = resolveSelectedMameRuntimeRoot(config);
  const pluginBootstrapSourcePath = resolvePluginBootstrapSourcePath(config);
  if (!pluginBootstrapSourcePath || !fs.existsSync(pluginBootstrapSourcePath) || !fs.statSync(pluginBootstrapSourcePath).isFile()) {
    throw new Error("No se puede preparar competicion v2: falta plugins/boot.lua en el runtime MAME seleccionado.");
  }
  let bundledRuntimeIntegrity = null;
  if (config.sharedMameRuntime?.source === "bundled") {
    bundledRuntimeIntegrity = await (options.verifyBundledMameRuntimeIntegrityImpl || verifyBundledMameRuntimeIntegrity)(mameRuntimeRoot, expectedMameVersion);
    await (options.verifyBundledPluginIntegrityImpl || verifyBundledPluginIntegrity)(readiness.sourceDir);
  } else if (readiness.provenance.mode !== "developer_override") {
    throw new Error("MAME externo solo esta permitido para QA mediante Developer Tools.");
  }

  const runId = createRunId(options);
  const runRoot = path.join(config.userDataDir, "runtime", "runs", runId);
  const snapshotRoot = path.join(runRoot, "pack");
  const snapshot = await (options.createSnapshotImpl || createVerifiedCompetitionSnapshot)(
    config.pack,
    snapshotRoot,
    options.snapshotOptions || {},
  );
  if (snapshot.manifestSha256 !== readiness.manifestSha256) {
    throw new Error("El pack ha cambiado mientras se preparaba la partida. Vuelve a intentarlo.");
  }
  const snapshotConfig = {
    ...config,
    pack: snapshot.snapshotPack,
    packRoot: snapshotRoot,
  };
  const snapshotProvenance = resolveCompetitionProvenance(
    snapshotConfig,
    snapshot.snapshotPack,
    snapshot.manifestSha256,
    options,
  );
  if (!snapshotProvenance.ok) throw new Error(`No se puede acreditar provenance local: ${snapshotProvenance.errors.join(" ")}`);

  const pluginSearchDir = path.join(runRoot, "plugins");
  const pluginDir = path.join(pluginSearchDir, readiness.pluginName);
  const integrityDir = path.join(runRoot, "integrity");
  const stagingRoot = path.join(runRoot, "events");
  const stagingCandidatesDir = path.join(stagingRoot, "candidates");
  const cfgDir = path.join(runRoot, "cfg");
  const ctrlrDir = path.join(runRoot, "ctrlr");
  const adapterSourcePath = snapshot.snapshotPack.contract.capture.adapterPath;
  const run = {
    adapterPreparedPath: path.join(pluginDir, "games", "adapter.lua"),
    adapterSourcePath,
    automaticCaptureStrategy: snapshot.snapshotPack.contract.capture.automatic.strategy,
    createdAt: (options.now || new Date()).toISOString(),
    cfgDir,
    controllerName: COMPETITION_CONTROLLER_NAME,
    controllerPath: path.join(ctrlrDir, `${COMPETITION_CONTROLLER_NAME}.cfg`),
    ctrlrDir,
    iniDir: path.join(runRoot, "ini"),
    integrityDir,
    pluginDir,
    pluginBootstrapPath: path.join(pluginSearchDir, "boot.lua"),
    pluginBootstrapSourcePath,
    pluginName: readiness.pluginName,
    pluginSearchDir,
    provenance: snapshotProvenance.provenance,
    receiptPath: snapshotProvenance.receiptPath,
    runId,
    runRoot,
    snapshotRoot,
    snapshot,
    stagingCandidatesDir,
    stagingRoot,
    integrity: {
      dips: readiness.integrity.dips.map(({ portTag, mask, value }) => ({ portTag, mask, value })),
      guardVersion: 1,
      manifestSha256: snapshot.manifestSha256,
      mameVersion: expectedMameVersion,
      observedMameVersion,
      packId: snapshot.snapshotPack.packId,
      pluginVersion: readiness.pluginVersion,
      provenance: snapshotProvenance.provenance,
      runId,
      version: 1,
    },
  };

  await Promise.all([
    fsp.mkdir(run.cfgDir, { recursive: true }),
    fsp.mkdir(run.ctrlrDir, { recursive: true }),
    fsp.mkdir(run.integrityDir, { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "nvram"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "inp"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "sta"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "snap"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "diff"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "comments"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "share"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "home"), { recursive: true }),
    fsp.mkdir(run.iniDir, { recursive: true }),
    fsp.mkdir(run.stagingCandidatesDir, { recursive: true }),
  ]);

  const copiedFiles = await copyPluginSource(readiness.sourceDir, pluginDir);
  await fsp.copyFile(run.pluginBootstrapSourcePath, run.pluginBootstrapPath);
  if (config.sharedMameRuntime?.source === "bundled") {
    await (options.verifyPreparedPluginIntegrityImpl || verifyBundledPluginIntegrity)(pluginDir);
    const expectedBoot = bundledRuntimeIntegrity.manifest.files.find((entry) => entry.path === "plugins/boot.lua");
    if (!expectedBoot || await sha256File(run.pluginBootstrapPath) !== expectedBoot.sha256) {
      throw new Error("boot.lua copiado no coincide con el runtime MAME bundled verificado.");
    }
  }
  await fsp.mkdir(path.dirname(run.adapterPreparedPath), { recursive: true });
  await fsp.copyFile(run.adapterSourcePath, run.adapterPreparedPath);
  const cfgSeed = snapshot.snapshotPack.contract.mame.profiles.competition.cfgDir;
  if (cfgSeed) await copyCfgSeed(cfgSeed, run.cfgDir);
  await fsp.writeFile(run.controllerPath, buildCompetitionControllerProfile(), "utf8");
  await fsp.writeFile(path.join(pluginDir, "config.lua"), buildRunConfigLua(run), "utf8");
  await fsp.writeFile(path.join(integrityDir, "identity.json"), `${JSON.stringify({
    version: 1,
    runId,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.writeFile(path.join(runRoot, "run.json"), JSON.stringify({
    schemaVersion: 2,
    adapter: readiness.adapter,
    adapterPreparedPath: run.adapterPreparedPath,
    adapterSourcePath: run.adapterSourcePath,
    automaticCaptureStrategy: run.automaticCaptureStrategy,
    createdAt: run.createdAt,
    controllerName: run.controllerName,
    controllerPath: run.controllerPath,
    expectedMameVersion,
    integrityDir,
    manifestSha256: run.integrity.manifestSha256,
    mameRuntimeRoot,
    observedMameVersion,
    packId: run.integrity.packId,
    packKey: scope.packKey,
    playerKey: scope.playerKey,
    pluginDir: run.pluginDir,
    pluginName: run.pluginName,
    provenance: run.provenance,
    runId,
    scopedQueueRoot: scope.scopedQueueRoot,
    snapshotRoot,
    stagingCandidatesDir,
  }, null, 2), "utf8");

  return {
    ...run,
    copiedFiles,
    config: {
      ...snapshotConfig,
      v2PluginRun: {
        adapterPreparedPath: run.adapterPreparedPath,
        adapterSourcePath: run.adapterSourcePath,
        cfgDir: run.cfgDir,
        controllerName: run.controllerName,
        controllerPath: run.controllerPath,
        ctrlrDir: run.ctrlrDir,
        iniDir: run.iniDir,
        integrity: run.integrity,
        integrityDir: run.integrityDir,
        pluginDir: run.pluginDir,
        pluginBootstrapPath: run.pluginBootstrapPath,
        pluginBootstrapSourcePath: run.pluginBootstrapSourcePath,
        pluginName: run.pluginName,
        pluginSearchDir: run.pluginSearchDir,
        provenance: run.provenance,
        runId: run.runId,
        runRoot: run.runRoot,
        snapshotRoot: run.snapshotRoot,
        stagingCandidatesDir: run.stagingCandidatesDir,
      },
    },
  };
}

module.exports = {
  buildRunConfigLua,
  copyCfgSeed,
  getV2CaptureReadiness,
  getV2CompetitionReadiness,
  isSafePluginName,
  pathInside,
  prepareV2CompetitionRun,
  resolvePluginBootstrapSourcePath,
  resolveSelectedMameRuntimeRoot,
  toLuaString,
};
