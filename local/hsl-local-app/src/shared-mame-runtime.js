const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const RUNTIME_SCHEMA_VERSION = 1;
const RUNTIME_CONFIG_RELATIVE_PATH = path.join("runtime", "mame-runtime.json");

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function getSharedMameRuntimeFile(config) {
  if (!config?.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para el runtime MAME compartido.");
  }

  return path.join(config.userDataDir, RUNTIME_CONFIG_RELATIVE_PATH);
}

function normalizeExecutablePath(mameExecutablePath) {
  if (!isNonEmptyString(mameExecutablePath)) {
    return null;
  }

  return path.resolve(mameExecutablePath.trim());
}

function looksLikeMameExecutable(mameExecutablePath) {
  const basename = path.basename(mameExecutablePath || "").toLowerCase();
  return basename === "mame.exe" || basename === "mame";
}

function inspectMameExecutable(mameExecutablePath) {
  const warnings = [];
  const errors = [];
  const normalizedPath = normalizeExecutablePath(mameExecutablePath);

  if (!normalizedPath) {
    return {
      available: false,
      errors: [],
      exists: false,
      isFile: false,
      looksLikeMame: false,
      mameExecutablePath: null,
      version: null,
      warnings,
    };
  }

  let stat = null;

  try {
    stat = fs.statSync(normalizedPath);
  } catch {
    errors.push("No se encontro mame.exe en el runtime compartido.");
  }

  const exists = Boolean(stat);
  const isFile = Boolean(stat?.isFile());
  const looksLikeMame = looksLikeMameExecutable(normalizedPath);

  if (exists && !isFile) {
    errors.push("La ruta del runtime MAME compartido existe, pero no es un archivo.");
  }

  if (exists && isFile && !looksLikeMame) {
    warnings.push("La ruta configurada no se llama mame.exe ni mame; verifica que sea el ejecutable correcto.");
  }

  return {
    available: exists && isFile,
    errors,
    exists,
    isFile,
    looksLikeMame,
    mameExecutablePath: normalizedPath,
    version: null,
    warnings,
  };
}

function emptyRuntimeState(config, overrides = {}) {
  const runtimeFile = config?.userDataDir ? getSharedMameRuntimeFile(config) : null;

  return {
    available: false,
    configured: false,
    errors: [],
    exists: false,
    isFile: false,
    looksLikeMame: false,
    mameExecutablePath: null,
    runtimeFile,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    selectedAt: null,
    updatedAt: null,
    version: null,
    warnings: [],
    ...overrides,
  };
}

function serializeRuntimeState(config, parsed, warnings = []) {
  const inspected = inspectMameExecutable(parsed?.mameExecutablePath);
  const configured = Boolean(inspected.mameExecutablePath);

  return emptyRuntimeState(config, {
    ...inspected,
    configured,
    schemaVersion: parsed?.schemaVersion || RUNTIME_SCHEMA_VERSION,
    selectedAt: typeof parsed?.selectedAt === "string" ? parsed.selectedAt : null,
    updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null,
    warnings: [
      ...warnings,
      ...inspected.warnings,
    ],
  });
}

function readSharedMameRuntime(config) {
  const runtimeFile = getSharedMameRuntimeFile(config);

  try {
    const raw = fs.readFileSync(runtimeFile, "utf8");
    const parsed = JSON.parse(raw);

    return serializeRuntimeState(config, parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyRuntimeState(config);
    }

    if (error instanceof SyntaxError) {
      return emptyRuntimeState(config, {
        error: `No se pudo leer mame-runtime.json: ${error.message}`,
        warnings: [`mame-runtime.json no es JSON valido: ${error.message}`],
      });
    }

    return emptyRuntimeState(config, {
      error: `No se pudo leer mame-runtime.json: ${error.message}`,
      warnings: [`No se pudo leer mame-runtime.json: ${error.message}`],
    });
  }
}

async function writeSharedMameRuntime(config, mameExecutablePath, options = {}) {
  const runtimeFile = getSharedMameRuntimeFile(config);
  const current = readSharedMameRuntime(config);
  const normalizedPath = normalizeExecutablePath(mameExecutablePath);

  if (!normalizedPath) {
    throw new Error("mameExecutablePath es obligatorio para configurar MAME compartido.");
  }

  const payload = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    mameExecutablePath: normalizedPath,
    selectedAt: current.selectedAt || options.selectedAt || new Date().toISOString(),
    updatedAt: options.updatedAt || new Date().toISOString(),
  };

  await fsp.mkdir(path.dirname(runtimeFile), { recursive: true });
  await fsp.writeFile(runtimeFile, JSON.stringify(payload, null, 2), "utf8");

  return readSharedMameRuntime(config);
}

module.exports = {
  RUNTIME_CONFIG_RELATIVE_PATH,
  RUNTIME_SCHEMA_VERSION,
  getSharedMameRuntimeFile,
  inspectMameExecutable,
  looksLikeMameExecutable,
  normalizeExecutablePath,
  readSharedMameRuntime,
  writeSharedMameRuntime,
};
