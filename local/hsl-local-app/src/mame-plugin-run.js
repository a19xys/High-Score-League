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
const { normalizeMameOptionToken, validatePackMameArguments } = require("./mame-arguments");
const { compareMameVersions, detectMameVersion } = require("./mame-version");
const {
  developerOverrideProvenance,
  readPackProvenanceReceipt,
  remoteVerifiedProvenance,
} = require("./pack-provenance");
const { getProductRuntime } = require("./product-runtime");
const { buildMameArgs } = require("./mame-launcher");
const { deriveCompetitionPlayerBinding } = require("./competition-player-binding");
const {
  buildRunInputManifest,
  verifyRunInputs,
  writePreparedMarker,
  writePreparingMarker,
} = require("./run-input-integrity");
const {
  PRODUCT_INTEGRITY_ROOT_FILENAME,
  PRODUCT_PLUGIN_INTEGRITY_FILENAME,
  PRODUCT_RUNTIME_INTEGRITY_FILENAME,
  readPluginVersion,
  sha256File,
  verifyProductIntegrityRoot,
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
    if (pluginVersion !== "0.4.0") errors.push(`Competicion protegida requiere hsl-score 0.4.0 exacto; se encontro ${pluginVersion}.`);
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
    for (const mode of ["practice", "competition"]) {
      const profileArgs = config.pack?.contract?.mame?.profiles?.[mode]?.launchArgs || [];
      if (profileArgs.some((token) => ["video", "bgfxscreenchains"].includes(normalizeMameOptionToken(token)))) {
        errors.push("Los ajustes visuales compartidos deben declararse en mame.launchArgs para que Práctica y Competición usen la misma presentación.");
      }
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
    let commonArgs = [];
    for (const [args, label] of [
      [config.pack?.contract?.mame?.launchArgs, "mame.launchArgs"],
      [config.pack?.contract?.mame?.profiles?.competition?.launchArgs, "mame.profiles.competition.launchArgs"],
    ]) {
      try {
        const validated = validatePackMameArguments(args, label, { mode: "competition" });
        if (label === "mame.launchArgs") commonArgs = validated;
      }
      catch (error) { errors.push(error.message); }
    }
    const visualCounts = { "-video": 0, "-bgfx_screen_chains": 0 };
    for (const token of commonArgs) if (Object.hasOwn(visualCounts, token)) visualCounts[token] += 1;
    if (visualCounts["-video"] !== 1 || visualCounts["-bgfx_screen_chains"] !== 1) {
      errors.push("Competicion protegida requiere exactamente un -video bgfx y un -bgfx_screen_chains seguro en mame.launchArgs.");
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
      const productRuntime = options.productRuntime || getProductRuntime();
      const rootPath = options.productRootPath || (productRuntime.appPath
        ? path.join(productRuntime.appPath, "product", PRODUCT_INTEGRITY_ROOT_FILENAME)
        : null);
      if (!rootPath || !fs.existsSync(rootPath)) errors.push("La build no contiene la raiz app-controlled de integridad de producto.");
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
    `  commitmentsDir = ${toLuaString(run.stagingCommitmentsDir)},`,
    `  candidateLedgerPath = ${toLuaString(run.candidateLedgerPath)},`,
    '  gameModule = "games/adapter.lua",',
    `  hslRunId = ${toLuaString(run.runId)},`,
    `  automaticCaptureStrategy = ${toLuaString(run.automaticCaptureStrategy)},`,
    "  competitionIntegrity = {",
    "    version = 1,",
    "    guardVersion = 2,",
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
    `  trackingIntervalFrames = ${run.automaticCaptureIntervalFrames},`,
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

async function listRegularFiles(rootDir) {
  const files = [];
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const filePath = path.join(rootDir, entry.name);
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`La preparacion contiene una entrada no regular: ${entry.name}.`);
    }
    if (stat.isDirectory()) files.push(...await listRegularFiles(filePath));
    else files.push(filePath);
  }
  return files;
}

function sealedLaunchPlan(launch, environmentOverrides = {}) {
  return {
    version: 1,
    command: launch.command,
    args: [...launch.args],
    cwd: launch.cwd,
    environmentOverrides: { ...environmentOverrides },
    mode: launch.mode,
    rom: launch.rom,
    pluginName: launch.pluginName,
    runtime: launch.runtime,
    mutableDirectories: { ...launch.mutableDirectories },
  };
}

async function prepareDeveloperQaHarness(run, options = {}) {
  const qa = options.developerQa;
  if (qa === undefined) return null;
  if (getProductRuntime().isPackaged === true || !qa || typeof qa !== "object" || Array.isArray(qa)
      || (run.provenance?.mode !== "developer_override" && qa.remoteVerifiedFixture !== true)) {
    throw new Error("El harness real de QA solo esta permitido por autoridad QA en una app no empaquetada.");
  }
  if (Object.keys(qa).some((key) => !["autobootScriptPath", "remoteVerifiedFixture", "violation"].includes(key))) {
    throw new Error("El harness real de QA contiene opciones desconocidas.");
  }
  const sourcePath = path.resolve(qa.autobootScriptPath || "");
  const sourceStat = await fsp.lstat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || path.extname(sourcePath).toLowerCase() !== ".lua") {
    throw new Error("El harness real de QA debe ser un archivo Lua regular.");
  }
  const allowedViolations = new Set(["clean", "pause", "dip_changed", "save_load", "reset"]);
  const violation = qa.violation === undefined ? null : String(qa.violation);
  if (violation !== null && !allowedViolations.has(violation)) {
    throw new Error("El modo de violacion del harness real de QA no esta permitido.");
  }
  const preparedPath = path.join(run.integrityDir, "developer-qa-autoboot.lua");
  await fsp.copyFile(sourcePath, preparedPath, fs.constants.COPYFILE_EXCL);
  const environmentOverrides = { HSL_COMPETITION_QA: "1" };
  if (violation !== null) {
    environmentOverrides.HSL_AUTO_QA_MARKER = path.join(run.integrityDir, "app", "developer-qa-reset.marker");
    environmentOverrides.HSL_AUTO_QA_VIOLATION = violation;
  }
  return { environmentOverrides, preparedPath, violation };
}


async function prepareV2CompetitionRun(config = {}, scope = {}, options = {}) {
  if (!config.userDataDir) throw new Error("No se pudo resolver userDataDir para preparar competicion v2.");
  if (!scope?.scopedQueueRoot || !scope?.playerKey || !scope?.packKey) {
    throw new Error("No se pudo resolver la cola scoped de cuenta y pack.");
  }
  const fastReadiness = getV2CompetitionReadiness(config, options);
  if (!fastReadiness.ok) throw new Error(`No se puede preparar competicion v2: ${fastReadiness.errors.join(" ")}`);
  const runId = createRunId(options);
  const runRoot = path.join(config.userDataDir, "runtime", "runs", runId);
  const snapshotRoot = path.join(runRoot, "pack");
  const createdAt = (options.now || new Date()).toISOString();
  await fsp.mkdir(path.dirname(runRoot), { recursive: true });
  await fsp.mkdir(runRoot, { recursive: false });
  await writePreparingMarker({ runId, runRoot, createdAt }, options);
  const snapshot = await (options.createSnapshotImpl || createVerifiedCompetitionSnapshot)(
    config.pack,
    snapshotRoot,
    options.snapshotOptions || {},
  );
  const snapshotConfig = {
    ...config,
    pack: snapshot.snapshotPack,
    packRoot: snapshotRoot,
  };
  const snapshotReadiness = getV2CompetitionReadiness(snapshotConfig, options);
  if (!snapshotReadiness.ok) {
    throw new Error(`La snapshot no supera el readiness competitivo autoritativo: ${snapshotReadiness.errors.join(" ")}`);
  }
  if (snapshotReadiness.manifestSha256 !== snapshot.manifestSha256) {
    throw new Error("La identidad del manifest autoritativo no coincide con la snapshot verificada.");
  }
  const expectedMameVersion = snapshotReadiness.integrity.mameVersion;
  const observedMameVersion = await Promise.resolve(
    (options.detectMameVersionImpl || detectMameVersion)(snapshotConfig.sharedMameRuntime.mameExecutablePath),
  );
  if (compareMameVersions(observedMameVersion, expectedMameVersion) !== 0) {
    throw new Error(`Competicion protegida requiere MAME ${expectedMameVersion} exacto; se encontro ${observedMameVersion}.`);
  }
  const mameRuntimeRoot = resolveSelectedMameRuntimeRoot(snapshotConfig);
  const pluginBootstrapSourcePath = resolvePluginBootstrapSourcePath(snapshotConfig);
  if (!pluginBootstrapSourcePath || !fs.existsSync(pluginBootstrapSourcePath) || !fs.statSync(pluginBootstrapSourcePath).isFile()) {
    throw new Error("No se puede preparar competicion v2: falta plugins/boot.lua en el runtime MAME seleccionado.");
  }
  let bundledProductIntegrity = null;
  if (snapshotConfig.sharedMameRuntime?.source === "bundled") {
    const productRuntime = options.productRuntime || getProductRuntime();
    const rootPath = options.productRootPath || path.join(productRuntime.appPath || "", "product", PRODUCT_INTEGRITY_ROOT_FILENAME);
    bundledProductIntegrity = await (options.verifyProductIntegrityRootImpl || verifyProductIntegrityRoot)({
      pluginRoot: snapshotReadiness.sourceDir,
      rootPath,
      runtimeRoot: mameRuntimeRoot,
    });
    if (bundledProductIntegrity.root.mameVersion !== expectedMameVersion
        || bundledProductIntegrity.root.pluginVersion !== snapshotReadiness.pluginVersion) {
      throw new Error("La raiz de producto no coincide con las versiones autoritativas de la snapshot.");
    }
  } else if (snapshotReadiness.provenance.mode !== "developer_override") {
    throw new Error("MAME externo solo esta permitido para QA mediante Developer Tools.");
  }
  const userId = scope.userId || scope.meta?.player?.userId || options.userId;
  const playerBinding = deriveCompetitionPlayerBinding(userId);
  const captureClientVersion = (options.productRuntime || getProductRuntime()).version;
  const pluginSearchDir = path.join(runRoot, "plugins");
  const pluginDir = path.join(pluginSearchDir, snapshotReadiness.pluginName);
  const integrityDir = path.join(runRoot, "integrity");
  const stagingRoot = path.join(runRoot, "events");
  const stagingCandidatesDir = path.join(stagingRoot, "candidates");
  const stagingCommitmentsDir = path.join(stagingRoot, "commitments");
  const cfgDir = path.join(runRoot, "cfg");
  const cfgSeedDir = path.join(runRoot, "seeds", "cfg");
  const ctrlrDir = path.join(runRoot, "ctrlr");
  const adapterSourcePath = snapshot.snapshotPack.contract.capture.adapterPath;
  const run = {
    adapterPreparedPath: path.join(pluginDir, "games", "adapter.lua"),
    adapterSourcePath,
    automaticCaptureIntervalFrames: snapshotReadiness.automatic.intervalFrames,
    automaticCaptureStrategy: snapshotReadiness.automatic.strategy,
    candidateLedgerPath: path.join(integrityDir, "candidate-set.log"),
    captureClientVersion,
    createdAt,
    cfgDir,
    cfgSeedDir,
    controllerName: COMPETITION_CONTROLLER_NAME,
    controllerPath: path.join(ctrlrDir, `${COMPETITION_CONTROLLER_NAME}.cfg`),
    ctrlrDir,
    iniDir: path.join(runRoot, "ini"),
    integrityDir,
    pluginDir,
    pluginBootstrapPath: path.join(pluginSearchDir, "boot.lua"),
    pluginBootstrapSourcePath,
    mameRuntimeRoot,
    playerBinding,
    pluginName: snapshotReadiness.pluginName,
    pluginSourceDir: snapshotReadiness.sourceDir,
    pluginSearchDir,
    provenance: snapshotReadiness.provenance.provenance,
    recoveryRecordPath: path.join(integrityDir, "recovery.json"),
    receiptPath: snapshotReadiness.provenance.receiptPath,
    runId,
    runRoot,
    snapshotRoot,
    snapshot,
    stagingCandidatesDir,
    stagingCommitmentsDir,
    stagingRoot,
    weekId: snapshot.snapshotPack.weekId,
    integrity: {
      captureClientVersion,
      dips: snapshotReadiness.integrity.dips.map(({ portTag, mask, value }) => ({ portTag, mask, value })),
      guardVersion: 2,
      manifestSha256: snapshot.manifestSha256,
      mameVersion: expectedMameVersion,
      observedMameVersion,
      packId: snapshot.snapshotPack.packId,
      playerBinding,
      pluginVersion: snapshotReadiness.pluginVersion,
      provenance: snapshotReadiness.provenance.provenance,
      runId,
      version: 2,
      weekId: snapshot.snapshotPack.weekId,
    },
  };

  await Promise.all([
    fsp.mkdir(run.cfgDir, { recursive: true }),
    fsp.mkdir(run.cfgSeedDir, { recursive: true }),
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
    fsp.mkdir(run.stagingCommitmentsDir, { recursive: true }),
    fsp.mkdir(path.join(run.integrityDir, "app"), { recursive: true }),
  ]);

  const copiedFiles = await copyPluginSource(snapshotReadiness.sourceDir, pluginDir);
  await fsp.copyFile(run.pluginBootstrapSourcePath, run.pluginBootstrapPath);
  if (snapshotConfig.sharedMameRuntime?.source === "bundled") {
    const expectedBoot = bundledProductIntegrity.runtime.manifest.files.find((entry) => entry.path === "plugins/boot.lua");
    if (!expectedBoot || await sha256File(run.pluginBootstrapPath) !== expectedBoot.sha256) {
      throw new Error("boot.lua copiado no coincide con el runtime MAME bundled verificado.");
    }
  }
  await fsp.mkdir(path.dirname(run.adapterPreparedPath), { recursive: true });
  await fsp.copyFile(run.adapterSourcePath, run.adapterPreparedPath);
  const cfgSeed = snapshot.snapshotPack.contract.mame.profiles.competition.cfgDir;
  if (cfgSeed) await copyCfgSeed(cfgSeed, run.cfgSeedDir);
  await fsp.writeFile(run.controllerPath, buildCompetitionControllerProfile(), "utf8");
  await fsp.writeFile(path.join(pluginDir, "config.lua"), buildRunConfigLua(run), "utf8");
  await fsp.writeFile(run.candidateLedgerPath, "", { encoding: "utf8", flag: "wx" });
  await fsp.writeFile(path.join(integrityDir, "identity.json"), `${JSON.stringify({
    version: 2,
    guardVersion: 2,
    runId,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    weekId: run.weekId,
    playerBinding: run.playerBinding,
    captureClientVersion: run.captureClientVersion,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.writeFile(run.recoveryRecordPath, `${JSON.stringify({
    version: 1,
    runId: run.runId,
    createdAt: run.createdAt,
    packId: run.integrity.packId,
    weekId: run.weekId,
    playerBinding: run.playerBinding,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    captureClientVersion: run.captureClientVersion,
    dips: run.integrity.dips,
    provenance: run.provenance,
    rom: snapshot.snapshotPack.rom,
    gameId: snapshot.snapshotPack.gameId,
    automaticCaptureStrategy: run.automaticCaptureStrategy,
    scopedQueueRoot: scope.scopedQueueRoot,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const developerQa = await prepareDeveloperQaHarness(run, options);
  run.developerQa = developerQa;
  const v2PluginRun = {
    adapterPreparedPath: run.adapterPreparedPath,
    adapterSourcePath: run.adapterSourcePath,
    automaticCaptureIntervalFrames: run.automaticCaptureIntervalFrames,
    automaticCaptureStrategy: run.automaticCaptureStrategy,
    candidateLedgerPath: run.candidateLedgerPath,
    captureClientVersion: run.captureClientVersion,
    cfgDir: run.cfgDir,
    cfgSeedDir: run.cfgSeedDir,
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
    pluginSourceDir: run.pluginSourceDir,
    provenance: run.provenance,
    runId: run.runId,
    runRoot: run.runRoot,
    mameRuntimeRoot: run.mameRuntimeRoot,
    playerBinding: run.playerBinding,
    sharedMameRuntime: snapshotConfig.sharedMameRuntime,
    snapshotRoot: run.snapshotRoot,
    stagingCandidatesDir: run.stagingCandidatesDir,
    stagingCommitmentsDir: run.stagingCommitmentsDir,
    weekId: run.weekId,
  };
  const preparedConfig = { ...snapshotConfig, v2PluginRun };
  run.config = preparedConfig;
  const launch = buildMameArgs(preparedConfig, snapshot.snapshotPack.rom, "competition");
  if (developerQa) {
    launch.args.push("-autoboot_delay", "0", "-autoboot_script", developerQa.preparedPath);
  }
  run.launchPlan = sealedLaunchPlan(launch, developerQa?.environmentOverrides);
  const inputs = [
    ...snapshot.copiedFiles.map((entry) => ({ filePath: path.join(snapshotRoot, ...entry.path.split("/")), role: "snapshot_protected" })),
    ...snapshot.supplementalSamples.map((filePath) => ({ filePath, role: "snapshot_sample" })),
    { filePath: path.join(snapshotRoot, "competition-manifest.json"), role: "competition_manifest" },
    ...copiedFiles.map((relativePath) => ({ filePath: path.join(pluginDir, relativePath), role: "plugin_code" })),
    { filePath: run.adapterPreparedPath, role: "prepared_adapter" },
    { filePath: run.pluginBootstrapPath, role: "plugin_bootstrap" },
    { filePath: path.join(pluginDir, "config.lua"), role: "generated_config" },
    { filePath: run.controllerPath, role: "competition_controller" },
    { filePath: path.join(integrityDir, "identity.json"), role: "run_identity" },
    { filePath: run.recoveryRecordPath, role: "recovery_record" },
    ...(developerQa ? [{ filePath: developerQa.preparedPath, role: "developer_qa_harness" }] : []),
  ];
  for (const filePath of await listRegularFiles(run.cfgSeedDir)) inputs.push({ filePath, role: "cfg_seed" });
  const runInputs = await buildRunInputManifest(run, inputs, run.launchPlan, {
    ...options,
    productRootPath: options.productRootPath,
  });
  run.runInputManifestPath = runInputs.manifestPath;
  run.runInputManifestSha256 = runInputs.sha256;
  run.integrity.runInputManifestSha256 = runInputs.sha256;
  v2PluginRun.launchPlan = run.launchPlan;
  v2PluginRun.runInputManifestPath = run.runInputManifestPath;
  v2PluginRun.runInputManifestSha256 = run.runInputManifestSha256;
  await fsp.writeFile(path.join(runRoot, "run.json"), JSON.stringify({
    schemaVersion: 3,
    adapter: snapshotReadiness.adapter,
    adapterPreparedPath: run.adapterPreparedPath,
    adapterSourcePath: run.adapterSourcePath,
    automaticCaptureStrategy: run.automaticCaptureStrategy,
    automaticCaptureIntervalFrames: run.automaticCaptureIntervalFrames,
    candidateLedgerPath: run.candidateLedgerPath,
    captureClientVersion: run.captureClientVersion,
    createdAt: run.createdAt,
    controllerName: run.controllerName,
    controllerPath: run.controllerPath,
    cfgSeedDir: run.cfgSeedDir,
    expectedMameVersion,
    integrityDir,
    manifestSha256: run.integrity.manifestSha256,
    mameRuntimeRoot,
    observedMameVersion,
    playerBinding: run.playerBinding,
    packId: run.integrity.packId,
    packKey: scope.packKey,
    playerKey: scope.playerKey,
    pluginDir: run.pluginDir,
    pluginName: run.pluginName,
    provenance: run.provenance,
    receiptPath: run.receiptPath,
    recoveryRecordPath: run.recoveryRecordPath,
    runId,
    runInputManifestPath: run.runInputManifestPath,
    runInputManifestSha256: run.runInputManifestSha256,
    scopedQueueRoot: scope.scopedQueueRoot,
    scopedFailedDir: scope.scopedFailedDir,
    scopedPendingDir: scope.scopedPendingDir,
    scopedRejectedDir: scope.scopedRejectedDir,
    scopedSentDir: scope.scopedSentDir,
    snapshotRoot,
    stagingCandidatesDir,
    stagingCommitmentsDir,
    weekId: run.weekId,
  }, null, 2), "utf8");
  await writePreparedMarker(run, options);
  await verifyRunInputs(run, options);

  return {
    ...run,
    copiedFiles,
    config: preparedConfig,
    snapshotReadiness,
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
