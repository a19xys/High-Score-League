const fsp = require("node:fs/promises");
const path = require("node:path");
const { getRepoPluginDir, listPluginFilesToCopy } = require("../src/dev-sync-plugin");

const APP_DIR = path.resolve(__dirname, "..");

async function stageProductPlugin(options = {}) {
  const sourceDir = options.sourceDir || getRepoPluginDir(APP_DIR, { isPackaged: false });
  const targetDir = options.targetDir || path.join(APP_DIR, ".cache", "product", "hsl", "mame-plugin", "hsl-score");
  const files = await listPluginFilesToCopy(sourceDir);
  if (!files.includes("init.lua") || !files.includes("plugin.json") || !files.some((file) => file.startsWith(`core${path.sep}`) || file.startsWith("core/"))) {
    throw new Error("La fuente de hsl-score no contiene los archivos de producto obligatorios.");
  }
  if (files.some((file) => /(^|[\\/])events([\\/]|$)/i.test(file) || /^config\.lua$/i.test(file))) {
    throw new Error("El staging de producto intento incluir estado mutable del plugin.");
  }
  await fsp.rm(targetDir, { recursive: true, force: true });
  for (const relativePath of files) {
    const targetPath = path.join(targetDir, relativePath);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(path.join(sourceDir, relativePath), targetPath);
  }
  process.stdout.write(`hsl-score preparado: ${files.length} archivos en ${targetDir}\n`);
  return { files, sourceDir, targetDir };
}

if (require.main === module) {
  stageProductPlugin().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { stageProductPlugin };
