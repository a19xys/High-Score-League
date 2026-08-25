const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function runProbe() {
  const appRoot = path.resolve(__dirname, "..");
  const fixture = path.join(appRoot, "test-support", "hsl-user-data-isolation-probe.cjs");
  const electronPath = require("electron");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-auth-isolation-probe-"));
  const hslUserDataDir = path.join(tempRoot, "virgin-hsl-data");
  const reportPath = path.join(tempRoot, "probe-report.json");
  let report;
  let fixtureRemoved = false;
  try {
    if (fs.existsSync(hslUserDataDir)) throw new Error("El root HSL del probe no era virgen.");
    const environment = {
      ...process.env,
      HSL_AUTH_ISOLATION_PROBE_REPORT: reportPath,
      HSL_USER_DATA_DIR: hslUserDataDir,
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, [
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-software-rasterizer",
      "--in-process-gpu",
      fixture,
    ], {
      cwd: appRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let diagnostics = "";
    const collect = (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-3000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timeout;
    const exitCode = await Promise.race([
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      }),
      new Promise((_, reject) => { timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Timeout del probe Electron-main."));
      }, 60_000); }),
    ]);
    clearTimeout(timeout);
    try {
      report = JSON.parse(await fsp.readFile(reportPath, "utf8"));
    } catch (error) {
      throw new Error(`El probe Electron-main no emitió informe (exit ${exitCode}): ${diagnostics || error.message}`);
    }
    if (exitCode !== 0 || report.ok === false) {
      throw new Error(`Probe Electron-main falló (${exitCode}): ${report.code || "PROBE_FAILED"} ${report.message || diagnostics}`);
    }
    const required = [
      report.isolation?.overrideActive,
      report.isolation?.electronProfileIsolated,
      report.isolation?.rootsDiffer,
      report.isolation?.hslRootMatchesOverride,
      report.configUsesHslRoot,
      report.safeStorageRoundTrip,
      report.directStorage?.identityMatches,
      report.directStorage?.revision === 1,
      report.repository?.canonicalIdentityMatches,
      report.repository?.knownAccountPresent,
      report.repository?.activeAccountMatches,
      report.repository?.locksReleased,
      report.repository?.revision > 0,
      report.repository?.revisionCommitted,
      report.fixtureRootsContained,
      report.noSyntheticSecretsInEnvelopes,
      report.normalHslState?.unchanged,
      report.storage?.provider === `electron-${process.platform}`,
      report.storage?.encryptionAvailable,
      report.storage?.warning === null,
    ];
    if (required.some((value) => value !== true)) {
      throw new Error(`Contrato incompleto del probe: ${JSON.stringify(report)}`);
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fixtureRemoved = !fs.existsSync(tempRoot);
  }
  const sanitized = {
    ...report,
    fixtureRemoved,
  };
  process.stdout.write(`${JSON.stringify(sanitized, null, 2)}\n`);
}

runProbe().catch((error) => {
  process.stderr.write(`${String(error?.message || error).slice(0, 1000)}\n`);
  process.exitCode = 1;
});
