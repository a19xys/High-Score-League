const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { path7za } = require("7zip-bin");
const { readMameRuntimeManifest } = require("../src/mame-runtime-manifest");
const { writeRuntimeIntegrityManifest } = require("../src/product-runtime-integrity");

const APP_DIR = path.resolve(__dirname, "..");
const REQUIRED_RUNTIME_ENTRIES = Object.freeze([
  ["file", "mame.exe"],
  ["file", "plugins/boot.lua"],
  ["file", "bgfx/chains/crt-geom.json"],
  ["directory", "bgfx/effects"],
  ["directory", "bgfx/shaders"],
  ["file", "COPYING"],
]);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ code, stderr, stdout })
      : reject(new Error(`${path.basename(command)} termino con codigo ${code}: ${stderr || stdout}`)));
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Descarga MAME fallo: HTTP ${response.status}.`);
  const tempPath = `${destination}.download`;
  await fsp.rm(tempPath, { force: true });
  const file = fs.createWriteStream(tempPath, { flags: "wx" });
  try {
    await new Promise((resolve, reject) => {
      const { Readable } = require("node:stream");
      Readable.fromWeb(response.body).pipe(file).on("finish", resolve).on("error", reject);
    });
    await fsp.rename(tempPath, destination);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

function validateRuntimeTree(runtimeDir) {
  const missing = [];
  for (const [kind, relativePath] of REQUIRED_RUNTIME_ENTRIES) {
    const target = path.join(runtimeDir, ...relativePath.split("/"));
    try {
      const stat = fs.statSync(target);
      if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) missing.push(relativePath);
    } catch {
      missing.push(relativePath);
    }
  }
  if (missing.length) throw new Error(`Runtime MAME incompleto; faltan: ${missing.join(", ")}.`);
  return true;
}

async function verifyMameExecutable(runtimeDir, version) {
  if (process.platform !== "win32") return { skipped: true, reason: "MAME Windows solo se ejecuta en Windows" };
  const result = await run(path.join(runtimeDir, "mame.exe"), ["-help"], { cwd: runtimeDir });
  const output = `${result.stdout}\n${result.stderr}`;
  if (!new RegExp(`MAME\\s+v?${version.replace(".", "\\.")}`, "i").test(output)) {
    throw new Error(`mame.exe -help no informa la version homologada ${version}.`);
  }
  return { skipped: false, version };
}

async function ensureVerifiedMameAsset(options = {}) {
  const manifest = options.manifest || readMameRuntimeManifest(options.manifestPath);
  const cacheDir = options.cacheDir || path.join(APP_DIR, ".cache", "mame", manifest.version);
  const assetPath = path.join(cacheDir, manifest.asset);
  await fsp.mkdir(cacheDir, { recursive: true });

  if (!fs.existsSync(assetPath)) {
    if (options.offline) throw new Error(`MAME no esta cacheado para modo offline: ${assetPath}`);
    process.stdout.write(`Descargando MAME ${manifest.version} x64 oficial...\n`);
    await (options.downloadImpl || downloadFile)(manifest.url, assetPath);
  }

  const digest = await sha256File(assetPath);
  if (digest !== manifest.sha256) {
    throw new Error(`SHA-256 incorrecto para ${manifest.asset}: esperado ${manifest.sha256}, obtenido ${digest}.`);
  }

  return { assetPath, cacheDir, digest, manifest };
}

async function extractMameArchive(assetPath, targetDir, workingDir) {
  await run(path7za, ["x", "-y", `-o${targetDir}`, assetPath], { cwd: workingDir });
}

async function prepareMame(options = {}) {
  const verified = await ensureVerifiedMameAsset(options);
  const { assetPath, cacheDir, digest, manifest } = verified;
  const runtimeDir = options.runtimeDir || path.join(cacheDir, "runtime");
  const extractImpl = options.extractImpl || extractMameArchive;
  const verifyExecutableImpl = options.verifyExecutableImpl || verifyMameExecutable;

  let extracted = false;
  try {
    validateRuntimeTree(runtimeDir);
  } catch {
    const tempDir = path.join(cacheDir, `runtime-extract-${process.pid}`);
    await fsp.rm(tempDir, { recursive: true, force: true });
    await fsp.mkdir(tempDir, { recursive: true });
    try {
      await extractImpl(assetPath, tempDir, cacheDir);
      validateRuntimeTree(tempDir);
      await fsp.rm(runtimeDir, { recursive: true, force: true });
      await fsp.rename(tempDir, runtimeDir);
      extracted = true;
    } catch (error) {
      await fsp.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  const executable = await verifyExecutableImpl(runtimeDir, manifest.version);
  const result = { assetPath, digest, executable, extracted, manifest, runtimeDir };
  process.stdout.write(`MAME ${manifest.version} listo: ${runtimeDir}\nSHA-256: ${digest}\n`);
  return result;
}

async function stageProductMame(options = {}) {
  const verified = await ensureVerifiedMameAsset(options);
  const { assetPath, cacheDir, digest, manifest } = verified;
  const runtimeDir = options.runtimeDir || path.join(APP_DIR, ".cache", "product", "mame", manifest.version, "runtime");
  const extractImpl = options.extractImpl || extractMameArchive;
  const verifyExecutableImpl = options.verifyExecutableImpl || verifyMameExecutable;
  const tempDir = path.join(
    path.dirname(runtimeDir),
    `.runtime-extract-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
  );

  await fsp.mkdir(path.dirname(runtimeDir), { recursive: true });
  await fsp.rm(tempDir, { recursive: true, force: true });
  await fsp.mkdir(tempDir, { recursive: true });

  try {
    await extractImpl(assetPath, tempDir, cacheDir);
    validateRuntimeTree(tempDir);
    const executable = await verifyExecutableImpl(tempDir, manifest.version);
    await writeRuntimeIntegrityManifest(tempDir, manifest.version);
    await fsp.rm(runtimeDir, { recursive: true, force: true });
    await fsp.rename(tempDir, runtimeDir);
    process.stdout.write(`MAME de producto ${manifest.version} reconstruido: ${runtimeDir}\nSHA-256: ${digest}\n`);
    return { assetPath, digest, executable, extracted: true, manifest, runtimeDir };
  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

if (require.main === module) {
  prepareMame({ offline: process.argv.includes("--offline") }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_RUNTIME_ENTRIES,
  ensureVerifiedMameAsset,
  prepareMame,
  sha256File,
  stageProductMame,
  validateRuntimeTree,
  verifyMameExecutable,
};
