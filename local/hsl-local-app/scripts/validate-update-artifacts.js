const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const yaml = require("js-yaml");
const packageMetadata = require("../package.json");

const FORBIDDEN_KEY = /^(authorization|requestheaders|token|gh_token|github_token)$/i;
const FORBIDDEN_TEXT = /(?:authorization\s*:|requestHeaders\s*:|GH_TOKEN|GITHUB_TOKEN|Bearer\s+)/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasForbiddenKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || hasForbiddenKey(child));
}

function isValidSha512(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length === 64;
  } catch {
    return false;
  }
}

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    fs.createReadStream(filePath).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => {
      resolve(hash.digest("base64"));
    });
  });
}

async function parseYamlFile(filePath) {
  const source = await fsp.readFile(filePath, "utf8");
  return { source, value: yaml.load(source) };
}

async function validateUpdateArtifacts(options = {}) {
  const appDir = options.appDir || path.resolve(__dirname, "..");
  const distDir = options.distDir || path.join(appDir, "dist");
  const expectedVersion = options.expectedVersion || packageMetadata.version;
  const appUpdatePath = path.join(distDir, "win-unpacked", "resources", "app-update.yml");
  const latestPath = path.join(distDir, "latest.yml");
  const appUpdate = await parseYamlFile(appUpdatePath);
  const latest = await parseYamlFile(latestPath);

  assert(appUpdate.value?.provider === "github", "app-update.yml: provider debe ser github.");
  assert(appUpdate.value?.owner === "a19xys", "app-update.yml: owner inesperado.");
  assert(appUpdate.value?.repo === "High-Score-League", "app-update.yml: repo inesperado.");
  assert(appUpdate.value?.channel === "latest", "app-update.yml: channel debe ser latest.");
  assert(!hasForbiddenKey(appUpdate.value) && !FORBIDDEN_TEXT.test(appUpdate.source), "app-update.yml contiene una clave de credencial prohibida.");

  assert(latest.value?.version === expectedVersion, `latest.yml declara ${latest.value?.version || "sin version"}; se esperaba ${expectedVersion}.`);
  assert(Array.isArray(latest.value?.files) && latest.value.files.length > 0, "latest.yml no contiene files updater.");
  assert(!hasForbiddenKey(latest.value) && !FORBIDDEN_TEXT.test(latest.source), "latest.yml contiene una clave de credencial prohibida.");

  const updaterFiles = latest.value.files.filter((entry) => /\.exe$/i.test(String(entry?.url || "")));
  assert(updaterFiles.length > 0, "latest.yml no referencia un instalador .exe.");
  for (const entry of updaterFiles) {
    assert(isValidSha512(entry.sha512), `latest.yml contiene SHA-512 invalido para ${entry.url || "installer"}.`);
  }

  const entries = await fsp.readdir(distDir, { withFileTypes: true });
  const installers = entries
    .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
    .map((entry) => path.join(distDir, entry.name));
  assert(installers.length > 0, "No se encontro el instalador NSIS .exe en dist.");

  let matched = null;
  for (const installerPath of installers) {
    const digest = await sha512File(installerPath);
    const metadata = updaterFiles.find((entry) => entry.sha512 === digest);
    if (metadata) {
      matched = { digest, installerPath, metadata };
      break;
    }
  }
  assert(matched, "Ningun SHA-512 de latest.yml coincide con el instalador NSIS construido.");

  const blockmapPath = `${matched.installerPath}.blockmap`;
  const blockmapStats = await fsp.stat(blockmapPath).catch(() => null);
  assert(blockmapStats?.isFile() && blockmapStats.size > 0, `Falta el blockmap del instalador: ${path.basename(blockmapPath)}.`);

  const installerStats = await fsp.stat(matched.installerPath);
  if (Number.isFinite(Number(matched.metadata.size))) {
    assert(Number(matched.metadata.size) === installerStats.size, "El size de latest.yml no coincide con el instalador construido.");
  }

  const result = {
    appUpdatePath,
    blockmapPath,
    channel: appUpdate.value.channel,
    installerPath: matched.installerPath,
    latestPath,
    localArtifactName: path.basename(matched.installerPath),
    metadataArtifactName: String(matched.metadata.url),
    owner: appUpdate.value.owner,
    provider: appUpdate.value.provider,
    repo: appUpdate.value.repo,
    safeArtifactNameDiffers: path.basename(matched.installerPath) !== path.basename(String(matched.metadata.url)),
    sha512: matched.digest,
    version: latest.value.version,
  };
  if (options.quiet !== true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  validateUpdateArtifacts().catch((error) => {
    process.stderr.write(`Validacion updater fallida: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  hasForbiddenKey,
  isValidSha512,
  sha512File,
  validateUpdateArtifacts,
};
