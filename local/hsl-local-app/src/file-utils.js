const fsp = require("fs/promises");

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function assertDirExists(dir, label) {
  const exists = await pathExists(dir);

  if (!exists) {
    throw new Error(`No existe la carpeta ${label}: ${dir}`);
  }

  const stat = await fsp.stat(dir);

  if (!stat.isDirectory()) {
    throw new Error(`${label} existe, pero no es una carpeta: ${dir}`);
  }
}

module.exports = {
  assertDirExists,
  pathExists,
};
