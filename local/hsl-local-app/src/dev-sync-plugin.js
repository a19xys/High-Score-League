const fsp = require("node:fs/promises");
const path = require("node:path");
const { APP_DIR } = require("./config");

const SYNC_PLUGIN_CONFIG_ERROR = "No hay pack MAME externo configurado. sync-plugin requiere mame.workingDir y mame.pluginName.";
const TOP_LEVEL_PLUGIN_FILES = ["init.lua", "plugin.json", "config.example.lua"];
const PLUGIN_SOURCE_DIRS = ["core", "games"];

function getRepoPluginDir(appDir = APP_DIR) {
  return path.resolve(appDir, "..", "mame-plugin", "hsl-score");
}

/**
 * @deprecated Development bridge helper for packVersion 1 packs with embedded
 * MAME. Replace with shared-runtime plugin/adaptor preparation after
 * LOCAL-SHARED-MAME-RUNTIME-1.
 */
function getConfiguredPackPluginDir(config) {
  const workingDir = config?.mame?.workingDir;
  const pluginName = config?.mame?.pluginName;

  if (typeof workingDir !== "string" || workingDir.trim() === "" || typeof pluginName !== "string" || pluginName.trim() === "") {
    throw new Error(SYNC_PLUGIN_CONFIG_ERROR);
  }

  return path.join(workingDir.trim(), "plugins", pluginName.trim());
}

async function pathIsDirectory(targetPath) {
  try {
    const stat = await fsp.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listFilesRecursively(rootDir, baseDir = rootDir) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath, baseDir));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(baseDir, entryPath));
    }
  }

  return files;
}

async function listPluginFilesToCopy(sourceDir) {
  const files = [];

  for (const filename of TOP_LEVEL_PLUGIN_FILES) {
    const filePath = path.join(sourceDir, filename);

    try {
      const stat = await fsp.stat(filePath);

      if (stat.isFile()) {
        files.push(filename);
      }
    } catch {
      // Missing optional source files are ignored; repo layout tests cover the expected set.
    }
  }

  for (const dirname of PLUGIN_SOURCE_DIRS) {
    const dirPath = path.join(sourceDir, dirname);

    if (await pathIsDirectory(dirPath)) {
      files.push(...await listFilesRecursively(dirPath, sourceDir));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function assertWorkingDirExists(workingDir) {
  let stat;

  try {
    stat = await fsp.stat(workingDir);
  } catch {
    throw new Error(`mame.workingDir no existe: ${workingDir}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`mame.workingDir existe, pero no es una carpeta: ${workingDir}`);
  }
}

/**
 * @deprecated Copies the plugin into a pack-local MAME tree for the temporary
 * dev bridge. packVersion 2 should use the shared MAME runtime path.
 */
async function syncPluginToPack(config, options = {}) {
  const sourceDir = options.sourceDir || getRepoPluginDir(config.appDir);
  const targetDir = options.targetDir || getConfiguredPackPluginDir(config);
  const dryRun = options.dryRun === true;
  const files = await listPluginFilesToCopy(sourceDir);

  await assertWorkingDirExists(config.mame.workingDir.trim());

  const copied = files.map((relativePath) => ({
    relativePath,
    sourcePath: path.join(sourceDir, relativePath),
    targetPath: path.join(targetDir, relativePath),
  }));

  if (!dryRun) {
    await fsp.mkdir(targetDir, { recursive: true });

    for (const file of copied) {
      await fsp.mkdir(path.dirname(file.targetPath), { recursive: true });
      await fsp.copyFile(file.sourcePath, file.targetPath);
    }
  }

  return {
    copied,
    dryRun,
    sourceDir,
    targetDir,
  };
}

function printSyncPluginResult(result) {
  console.log("");
  console.log(result.dryRun ? "Sync plugin dry-run" : "Sync plugin");
  console.log("===================");
  console.log(`Origen:  ${result.sourceDir}`);
  console.log(`Destino: ${result.targetDir}`);
  console.log("");

  if (result.copied.length === 0) {
    console.log("[WARN] No se encontraron archivos de plugin para copiar.");
  } else {
    for (const file of result.copied) {
      console.log(`${result.dryRun ? "[DRY-RUN]" : "[OK]"} ${file.relativePath}`);
    }
  }

  console.log("");

  if (result.dryRun) {
    console.log("No se modifico ningun archivo.");
  } else {
    console.log("Plugin sincronizado. No se copiaron config.lua, eventos, ROMs ni MAME.");
  }

  console.log("");
}

async function syncPluginCommand(config, options = {}) {
  const result = await syncPluginToPack(config, options);
  printSyncPluginResult(result);
  return result;
}

module.exports = {
  SYNC_PLUGIN_CONFIG_ERROR,
  getConfiguredPackPluginDir,
  getRepoPluginDir,
  listPluginFilesToCopy,
  printSyncPluginResult,
  syncPluginCommand,
  syncPluginToPack,
};
