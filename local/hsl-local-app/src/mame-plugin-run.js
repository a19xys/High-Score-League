const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { getRepoPluginDir, listPluginFilesToCopy } = require("./dev-sync-plugin");
const { isUnsafePackRelativePath } = require("./pack-contract");

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

function createRunId(options = {}) {
  if (options.runId) {
    return String(options.runId);
  }

  const timestamp = (options.now || new Date()).toISOString().replace(/[:.]/g, "-");
  return `run_${timestamp}_${crypto.randomBytes(4).toString("hex")}`;
}

function toLuaString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildRunConfigLua(run) {
  return [
    "return {",
    `  outputDir = ${toLuaString(run.stagingPendingDir)},`,
    '  gameModule = "games/adapter.lua",',
    `  hslRunId = ${toLuaString(run.runId)},`,
    "  enableFrameTracking = true,",
    "  trackingIntervalFrames = 5,",
    "  debugEvent = false",
    "}",
    "",
  ].join("\n");
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

  const readiness = getV2CaptureReadiness(config, options);

  if (!readiness.ok) {
    throw new Error(`No se puede preparar competicion v2: ${readiness.errors.join(" ")}`);
  }

  const runId = createRunId(options);
  const runRoot = path.join(config.userDataDir, "runtime", "runs", runId);
  const pluginSearchDir = path.join(runRoot, "plugins");
  const pluginDir = path.join(pluginSearchDir, readiness.pluginName);
  const stagingRoot = path.join(runRoot, "events");
  const run = {
    adapterPreparedPath: path.join(pluginDir, "games", "adapter.lua"),
    adapterSourcePath: readiness.adapterPath,
    createdAt: (options.now || new Date()).toISOString(),
    pluginDir,
    pluginName: readiness.pluginName,
    pluginSearchDir,
    runId,
    runRoot,
    stagingFailedDir: path.join(stagingRoot, "failed"),
    stagingPendingDir: path.join(stagingRoot, "pending"),
    stagingRoot,
    stagingSentDir: path.join(stagingRoot, "sent"),
  };

  const copiedFiles = await copyPluginSource(readiness.sourceDir, pluginDir);
  await fsp.mkdir(path.dirname(run.adapterPreparedPath), { recursive: true });
  await fsp.copyFile(readiness.adapterPath, run.adapterPreparedPath);
  await Promise.all([
    fsp.mkdir(run.stagingPendingDir, { recursive: true }),
    fsp.mkdir(run.stagingFailedDir, { recursive: true }),
    fsp.mkdir(run.stagingSentDir, { recursive: true }),
  ]);
  await fsp.writeFile(path.join(pluginDir, "config.lua"), buildRunConfigLua(run), "utf8");
  await fsp.writeFile(path.join(runRoot, "run.json"), JSON.stringify({
    schemaVersion: 1,
    adapter: readiness.adapter,
    adapterPreparedPath: run.adapterPreparedPath,
    adapterSourcePath: run.adapterSourcePath,
    createdAt: run.createdAt,
    packId: config.pack?.packId || null,
    packKey: scope.packKey,
    playerKey: scope.playerKey,
    pluginDir: run.pluginDir,
    pluginName: run.pluginName,
    runId: run.runId,
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
        pluginDir: run.pluginDir,
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
  getV2CaptureReadiness,
  isSafePluginName,
  pathInside,
  prepareV2CompetitionRun,
  toLuaString,
};
