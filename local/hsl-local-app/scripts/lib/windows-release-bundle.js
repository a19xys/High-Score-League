const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { assertStableVersion, tagForVersion } = require("./windows-release-version");

const MANIFEST_NAME = "release-manifest.json";
const METADATA_NAME = "latest.yml";
const SOURCE_REF = "refs/heads/master";
const SAFE_REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSafeRemoteName(name, suffix) {
  invariant(typeof name === "string" && SAFE_REMOTE_NAME.test(name), `Nombre remoto inseguro: ${String(name)}.`);
  invariant(path.basename(name) === name && !name.includes(".."), `Nombre remoto contiene una ruta: ${name}.`);
  if (suffix) invariant(name.toLowerCase().endsWith(suffix), `Nombre remoto inesperado: ${name}.`);
  return name;
}

function assertSource(sourceCommit, sourceRef) {
  invariant(/^[0-9a-f]{40}$/.test(String(sourceCommit)), "sourceCommit debe ser un SHA Git completo en minusculas.");
  invariant(sourceRef === SOURCE_REF, `sourceRef debe ser ${SOURCE_REF}.`);
}

function hashFile(filePath, algorithm = "sha256", encoding = "hex") {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest(encoding)));
  });
}

function sha512File(filePath) {
  return hashFile(filePath, "sha512", "base64");
}

async function describeAsset(filePath, name, extra = {}) {
  const stats = await fsp.stat(filePath);
  invariant(stats.isFile() && stats.size > 0, `Asset ausente o vacio: ${name}.`);
  return {
    name,
    size: stats.size,
    sha256: await hashFile(filePath),
    ...extra,
  };
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("latest.yml contiene un scalar quoted invalido.");
    }
  }
  return trimmed;
}

function parseLatestMetadata(source) {
  invariant(typeof source === "string", "latest.yml debe ser texto.");
  const versionMatch = source.match(/^version:\s*(.+?)\s*$/m);
  const fileMatch = source.match(/^\s*-\s+url:\s*(.+?)\s*\r?\n\s+sha512:\s*(.+?)\s*\r?\n\s+size:\s*(\d+)\s*$/m);
  invariant(versionMatch && fileMatch, "latest.yml no contiene version y entrada updater completas.");
  return {
    version: unquoteYamlScalar(versionMatch[1]),
    installerName: unquoteYamlScalar(fileMatch[1]),
    sha512: unquoteYamlScalar(fileMatch[2]),
    size: Number(fileMatch[3]),
  };
}

async function assertUnambiguousInstaller(distDir, sha512) {
  const entries = await fsp.readdir(distDir, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name));
  const matching = [];
  for (const entry of candidates) {
    const filePath = path.join(distDir, entry.name);
    if (await sha512File(filePath) === sha512) matching.push(filePath);
  }
  invariant(matching.length === 1, `Se esperaba un unico installer para el SHA-512 updater; encontrados: ${matching.length}.`);
  return matching[0];
}

async function prepareWindowsReleaseBundle(options) {
  // This dependency is intentionally lazy: prepare runs after npm ci, while the
  // privileged stage/publish jobs can validate the bundle with Node built-ins only.
  const { validateUpdateArtifacts } = require("../validate-update-artifacts");
  const appDir = options.appDir || path.resolve(__dirname, "../..");
  const distDir = options.distDir || path.join(appDir, "dist");
  const bundleDir = options.bundleDir || path.join(appDir, "release-bundle");
  const version = options.version;
  const sourceCommit = String(options.sourceCommit || "");
  const sourceRef = String(options.sourceRef || "");
  assertStableVersion(version);
  assertSource(sourceCommit, sourceRef);

  const validated = await validateUpdateArtifacts({ appDir, distDir, expectedVersion: version, quiet: true });
  const installerName = assertSafeRemoteName(validated.metadataArtifactName, ".exe");
  const blockmapName = assertSafeRemoteName(`${installerName}.blockmap`, ".exe.blockmap");
  const installerPath = await assertUnambiguousInstaller(distDir, validated.sha512);

  const resolvedApp = path.resolve(appDir);
  const resolvedBundle = path.resolve(bundleDir);
  invariant(resolvedBundle.startsWith(`${resolvedApp}${path.sep}`), "release-bundle debe estar contenido dentro del directorio de la app.");
  invariant(path.basename(resolvedBundle) === "release-bundle", "Solo se permite regenerar un directorio llamado release-bundle.");
  await fsp.rm(resolvedBundle, { recursive: true, force: true });
  await fsp.mkdir(resolvedBundle, { recursive: true });

  const targetMetadata = path.join(resolvedBundle, METADATA_NAME);
  const targetInstaller = path.join(resolvedBundle, installerName);
  const targetBlockmap = path.join(resolvedBundle, blockmapName);
  await fsp.copyFile(validated.latestPath, targetMetadata);
  await fsp.copyFile(installerPath, targetInstaller);
  await fsp.copyFile(validated.blockmapPath, targetBlockmap);

  const manifest = {
    schemaVersion: 1,
    version,
    tag: tagForVersion(version),
    sourceCommit,
    sourceRef,
    assets: {
      metadata: await describeAsset(targetMetadata, METADATA_NAME),
      installer: await describeAsset(targetInstaller, installerName, { sha512: validated.sha512 }),
      blockmap: await describeAsset(targetBlockmap, blockmapName),
    },
  };
  await fsp.writeFile(path.join(resolvedBundle, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return validateWindowsReleaseBundle({ bundleDir: resolvedBundle, expectedVersion: version, sourceCommit, sourceRef });
}

function assertManifestAsset(asset, expectedName, label) {
  invariant(asset && typeof asset === "object" && !Array.isArray(asset), `Manifest sin asset ${label}.`);
  assertSafeRemoteName(asset.name);
  invariant(asset.name === expectedName, `Nombre ${label} incoherente: ${asset.name}.`);
  invariant(Number.isSafeInteger(asset.size) && asset.size > 0, `Size ${label} invalido.`);
  invariant(/^[0-9a-f]{64}$/.test(asset.sha256), `SHA-256 ${label} invalido.`);
}

async function validateWindowsReleaseBundle(options) {
  const bundleDir = path.resolve(options.bundleDir);
  const manifestPath = path.join(bundleDir, MANIFEST_NAME);
  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  invariant(manifest.schemaVersion === 1, "Schema de release-manifest no soportado.");
  assertStableVersion(manifest.version);
  invariant(manifest.tag === tagForVersion(manifest.version), "Tag del manifest incoherente.");
  assertSource(manifest.sourceCommit, manifest.sourceRef);
  if (options.expectedVersion) invariant(manifest.version === options.expectedVersion, "Version del bundle distinta de la esperada.");
  if (options.sourceCommit) invariant(manifest.sourceCommit === options.sourceCommit, "sourceCommit del bundle distinto del esperado.");
  if (options.sourceRef) invariant(manifest.sourceRef === options.sourceRef, "sourceRef del bundle distinto del esperado.");

  const installerName = assertSafeRemoteName(manifest.assets?.installer?.name, ".exe");
  const blockmapName = `${installerName}.blockmap`;
  assertManifestAsset(manifest.assets.metadata, METADATA_NAME, "metadata");
  assertManifestAsset(manifest.assets.installer, installerName, "installer");
  assertManifestAsset(manifest.assets.blockmap, blockmapName, "blockmap");
  invariant(/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.assets.installer.sha512), "SHA-512 installer invalido.");

  const expectedNames = [METADATA_NAME, installerName, blockmapName, MANIFEST_NAME].sort();
  const entries = await fsp.readdir(bundleDir, { withFileTypes: true });
  invariant(entries.every((entry) => entry.isFile()), "El bundle no puede contener subdirectorios.");
  const actualNames = entries.map((entry) => entry.name).sort();
  invariant(JSON.stringify(actualNames) === JSON.stringify(expectedNames), `Contenido de bundle inesperado: ${actualNames.join(", ")}.`);

  for (const asset of Object.values(manifest.assets)) {
    const filePath = path.join(bundleDir, asset.name);
    const actual = await describeAsset(filePath, asset.name);
    invariant(actual.size === asset.size, `Size local distinto para ${asset.name}.`);
    invariant(actual.sha256 === asset.sha256, `SHA-256 local distinto para ${asset.name}.`);
  }
  const installerPath = path.join(bundleDir, installerName);
  invariant(await sha512File(installerPath) === manifest.assets.installer.sha512, "SHA-512 local del installer no coincide con el manifest.");
  const latest = parseLatestMetadata(await fsp.readFile(path.join(bundleDir, METADATA_NAME), "utf8"));
  invariant(latest.version === manifest.version, "latest.yml y manifest declaran versiones distintas.");
  invariant(latest.installerName === installerName, "latest.yml no referencia el safeArtifactName del bundle.");
  invariant(latest.sha512 === manifest.assets.installer.sha512, "latest.yml y manifest declaran SHA-512 distintos.");
  invariant(latest.size === manifest.assets.installer.size, "latest.yml y manifest declaran tamaños distintos.");

  const releaseManifest = await describeAsset(manifestPath, MANIFEST_NAME);
  return {
    bundleDir,
    manifest,
    assets: [
      { ...manifest.assets.metadata, path: path.join(bundleDir, METADATA_NAME) },
      { ...manifest.assets.installer, path: installerPath },
      { ...manifest.assets.blockmap, path: path.join(bundleDir, blockmapName) },
      { ...releaseManifest, path: manifestPath },
    ],
  };
}

module.exports = {
  MANIFEST_NAME,
  METADATA_NAME,
  SOURCE_REF,
  assertSafeRemoteName,
  hashFile,
  parseLatestMetadata,
  prepareWindowsReleaseBundle,
  validateWindowsReleaseBundle,
};
