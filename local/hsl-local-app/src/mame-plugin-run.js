const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { getRepoPluginDir, listPluginFilesToCopy } = require("./dev-sync-plugin");
const { isUnsafePackRelativePath } = require("./pack-contract");
const { verifyCompetitionManifest } = require("./competition-manifest");
const {
  COMPETITION_CONTROLLER_NAME,
  buildCompetitionControllerProfile,
} = require("./mame-controller-profile");
const { validatePackMameArguments } = require("./mame-arguments");
const { compareMameVersions, detectMameVersion } = require("./mame-version");

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

  if (!integrity || integrity.version !== 1) {
    errors.push("Este pack no esta preparado para Competicion protegida: falta integrity v1.");
  } else {
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
  }

  return {
    ...captureReadiness,
    errors,
    ok: errors.length === 0,
    integrity,
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
    `  outputDir = ${toLuaString(run.stagingPendingDir)},`,
    '  gameModule = "games/adapter.lua",',
    `  hslRunId = ${toLuaString(run.runId)},`,
    "  competitionIntegrity = {",
    "    version = 1,",
    "    guardVersion = 1,",
    `    runId = ${toLuaString(run.runId)},`,
    `    packId = ${toLuaString(run.integrity.packId)},`,
    `    manifestSha256 = ${toLuaString(run.integrity.manifestSha256)},`,
    `    mameVersion = ${toLuaString(run.integrity.mameVersion)},`,
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
  if (!config.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para preparar competicion v2.");
  }

  if (!scope?.scopedQueueRoot || !scope?.playerKey || !scope?.packKey) {
    throw new Error("No se pudo resolver la cola scoped de cuenta y pack.");
  }

  const readiness = getV2CompetitionReadiness(config, options);

  if (!readiness.ok) {
    throw new Error(`No se puede preparar competicion v2: ${readiness.errors.join(" ")}`);
  }

  const manifest = await (options.verifyCompetitionManifestImpl || verifyCompetitionManifest)(config.pack);
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

  const runId = createRunId(options);
  const runRoot = path.join(config.userDataDir, "runtime", "runs", runId);
  const pluginSearchDir = path.join(runRoot, "plugins");
  const pluginDir = path.join(pluginSearchDir, readiness.pluginName);
  const stagingRoot = path.join(runRoot, "events");
  const cfgDir = path.join(runRoot, "cfg");
  const ctrlrDir = path.join(runRoot, "ctrlr");
  const run = {
    adapterPreparedPath: path.join(pluginDir, "games", "adapter.lua"),
    adapterSourcePath: readiness.adapterPath,
    createdAt: (options.now || new Date()).toISOString(),
    cfgDir,
    controllerName: COMPETITION_CONTROLLER_NAME,
    controllerPath: path.join(ctrlrDir, `${COMPETITION_CONTROLLER_NAME}.cfg`),
    ctrlrDir,
    iniDir: path.join(runRoot, "ini"),
    pluginDir,
    pluginBootstrapPath: path.join(pluginSearchDir, "boot.lua"),
    pluginBootstrapSourcePath,
    pluginName: readiness.pluginName,
    pluginSearchDir,
    runId,
    runRoot,
    integrity: {
      dips: readiness.integrity.dips.map(({ portTag, mask, value }) => ({ portTag, mask, value })),
      guardVersion: 1,
      manifestSha256: manifest.manifestSha256,
      mameVersion: expectedMameVersion,
      observedMameVersion,
      packId: config.pack.packId,
      runId,
      version: 1,
    },
    stagingFailedDir: path.join(stagingRoot, "failed"),
    stagingPendingDir: path.join(stagingRoot, "pending"),
    stagingRoot,
    stagingSentDir: path.join(stagingRoot, "sent"),
  };

  const copiedFiles = await copyPluginSource(readiness.sourceDir, pluginDir);
  await fsp.copyFile(run.pluginBootstrapSourcePath, run.pluginBootstrapPath);
  await fsp.mkdir(path.dirname(run.adapterPreparedPath), { recursive: true });
  await fsp.copyFile(readiness.adapterPath, run.adapterPreparedPath);
  await Promise.all([
    fsp.mkdir(run.cfgDir, { recursive: true }),
    fsp.mkdir(run.ctrlrDir, { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "nvram"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "inp"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "sta"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "snap"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "diff"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "comments"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "share"), { recursive: true }),
    fsp.mkdir(path.join(run.runRoot, "home"), { recursive: true }),
    fsp.mkdir(run.iniDir, { recursive: true }),
    fsp.mkdir(run.stagingPendingDir, { recursive: true }),
    fsp.mkdir(run.stagingFailedDir, { recursive: true }),
    fsp.mkdir(run.stagingSentDir, { recursive: true }),
  ]);
  const cfgSeed = config.pack.contract.mame.profiles.competition.cfgDir;
  if (cfgSeed) await copyCfgSeed(cfgSeed, run.cfgDir);
  await fsp.writeFile(run.controllerPath, buildCompetitionControllerProfile(), "utf8");
  await fsp.writeFile(path.join(pluginDir, "config.lua"), buildRunConfigLua(run), "utf8");
  await fsp.writeFile(path.join(runRoot, "run.json"), JSON.stringify({
    schemaVersion: 1,
    adapter: readiness.adapter,
    adapterPreparedPath: run.adapterPreparedPath,
    adapterSourcePath: run.adapterSourcePath,
    createdAt: run.createdAt,
    controllerName: run.controllerName,
    controllerPath: run.controllerPath,
    iniDir: run.iniDir,
    packId: config.pack?.packId || null,
    packKey: scope.packKey,
    playerKey: scope.playerKey,
    pluginDir: run.pluginDir,
    pluginBootstrapPath: run.pluginBootstrapPath,
    pluginBootstrapSourcePath: run.pluginBootstrapSourcePath,
    pluginName: run.pluginName,
    runId: run.runId,
    mameRuntimeRoot,
    manifestSha256: run.integrity.manifestSha256,
    expectedMameVersion,
    observedMameVersion,
    scopedQueueRoot: scope.scopedQueueRoot,
    stagingPendingDir: run.stagingPendingDir,
  }, null, 2), "utf8");

  return {
    ...run,
    copiedFiles,
    config: {
      ...config,
      v2PluginRun: {
        adapterPreparedPath: run.adapterPreparedPath,
        adapterSourcePath: run.adapterSourcePath,
        iniDir: run.iniDir,
        cfgDir: run.cfgDir,
        controllerName: run.controllerName,
        controllerPath: run.controllerPath,
        ctrlrDir: run.ctrlrDir,
        integrity: run.integrity,
        pluginDir: run.pluginDir,
        pluginBootstrapPath: run.pluginBootstrapPath,
        pluginBootstrapSourcePath: run.pluginBootstrapSourcePath,
        pluginName: run.pluginName,
        pluginSearchDir: run.pluginSearchDir,
        runId: run.runId,
        runRoot: run.runRoot,
        stagingPendingDir: run.stagingPendingDir,
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
