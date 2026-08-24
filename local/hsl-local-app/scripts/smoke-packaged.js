const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const packageMetadata = require("../package.json");
const { readMameRuntimeManifest } = require("../src/mame-runtime-manifest");

const EXPECTED_HSL_ORIGIN = "https://highscoreleague.com";

async function waitForFile(filePath, timeoutMs = 120_000, child = null, output = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return JSON.parse(await fsp.readFile(filePath, "utf8"));
    if (child?.exitCode !== null) {
      throw new Error(`La app empaquetada termino antes de readiness (exit ${child.exitCode}). ${output?.() || ""}`.trim());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`La app empaquetada no emitio readiness en ${timeoutMs} ms.`);
}

async function smokePackaged(options = {}) {
  if (process.platform !== "win32") throw new Error("El smoke empaquetado requiere Windows.");
  const appDir = path.resolve(__dirname, "..");
  const unpackedDir = options.unpackedDir || path.join(appDir, "dist", "win-unpacked");
  const executablePath = path.join(unpackedDir, "High Score League.exe");
  const resourcesPath = path.join(unpackedDir, "resources");
  const manifest = readMameRuntimeManifest();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-packaged-smoke-"));
  const reportPath = path.join(tempDir, "readiness.json");
  await fsp.access(executablePath);
  await fsp.access(path.join(resourcesPath, "mame", manifest.version, "mame.exe"));
  await fsp.access(path.join(resourcesPath, "hsl", "mame-plugin", "hsl-score", "init.lua"));
  let diagnosticOutput = "";
  const child = spawn(executablePath, [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--in-process-gpu",
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      HSL_PACKAGED_SMOKE_FILE: reportPath,
      HSL_USER_DATA_DIR: path.join(tempDir, "userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const collect = (chunk) => { diagnosticOutput = `${diagnosticOutput}${String(chunk)}`.slice(-4000); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  try {
    const report = await waitForFile(reportPath, options.timeoutMs, child, () => diagnosticOutput);
    if (!report.isPackaged || report.version !== packageMetadata.version || report.productName !== "High Score League") {
      throw new Error(`Readiness empaquetada invalida: ${JSON.stringify(report)}`);
    }
    if (!report.mame?.available || report.mame.version !== manifest.version || !report.productConfigAvailable || !report.pluginAvailable) {
      throw new Error(`Recursos empaquetados incompletos: ${JSON.stringify(report)}`);
    }
    if (
      report.effectiveHslOrigin !== EXPECTED_HSL_ORIGIN
      || report.productConfigSource !== "product-metadata"
      || report.remoteConfigurationSource !== "launcher-config"
    ) {
      throw new Error(`Autoridad HSL empaquetada invalida: ${JSON.stringify(report)}`);
    }
    if (report.windowsUpdate?.enabled !== false || report.windowsUpdate?.enableReason !== "packaged-smoke") {
      throw new Error(`El updater no quedo aislado durante smoke: ${JSON.stringify(report.windowsUpdate)}`);
    }
    const integrityQa = report.packagedIntegrityQa;
    if (!integrityQa?.ok || !integrityQa.appPathContainsAsar || !integrityQa.productRootResolved
        || !integrityQa.verifyRunInputsPassed || !integrityQa.monitorStarted || !integrityQa.postRunVerified
        || integrityQa.virtualAsarPathWatched || !integrityQa.asarContainerWatched) {
      throw new Error(`QA de integridad app.asar invalida: ${JSON.stringify(integrityQa)}`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await fsp.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (require.main === module) {
  smokePackaged().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_HSL_ORIGIN, smokePackaged, waitForFile };
