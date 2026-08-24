const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { atomicWriteJson } = require("./secure-session-storage");
const {
  PRODUCT_INTEGRITY_ROOT_FILENAME,
  PRODUCT_PLUGIN_INTEGRITY_FILENAME,
  PRODUCT_RUNTIME_INTEGRITY_FILENAME,
  sha256File,
  verifyProductIntegrityRoot,
} = require("./product-runtime-integrity");
const { getProductRuntime } = require("./product-runtime");

const RUN_INPUT_MANIFEST_FILENAME = "run-input-manifest.json";
const LAUNCH_PLAN_FILENAME = "launch-plan.json";
const PREPARED_MARKER_FILENAME = "prepared.marker";
const PREPARING_MARKER_FILENAME = "preparing.marker";
const RUN_INPUT_STATE_FILENAME = "run-input-state.json";
const MAME_EXIT_FILENAME = "mame-exit.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

class RunInputIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RunInputIntegrityError";
    this.code = code;
  }
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pathInside(childPath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function portableRelative(rootPath, filePath) {
  if (!pathInside(filePath, rootPath)) throw new RunInputIntegrityError("input_outside_run", "Un input sellado queda fuera del run.");
  return path.relative(rootPath, filePath).replace(/\\/g, "/");
}

async function atomicWriteBytes(filePath, bytes, options = {}) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const expectedHash = sha256Bytes(bytes);
  try {
    const existing = await fsp.readFile(filePath);
    if (sha256Bytes(existing) === expectedHash && existing.equals(bytes)) return { alreadyExists: true, filePath, sha256: expectedHash };
    throw new RunInputIntegrityError("atomic_destination_conflict", `El destino ya existe con otros bytes: ${path.basename(filePath)}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
  let handle;
  try {
    handle = await fsp.open(temporaryPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporaryPath, filePath);
    if (options.syncDirectory !== false) {
      const directory = await fsp.open(path.dirname(filePath), fs.constants.O_RDONLY).catch(() => null);
      await directory?.sync().catch(() => null);
      await directory?.close().catch(() => null);
    }
    return { alreadyExists: false, filePath, sha256: expectedHash };
  } catch (error) {
    await handle?.close().catch(() => null);
    await fsp.rm(temporaryPath, { force: true }).catch(() => null);
    if (["EEXIST", "EPERM"].includes(error?.code)) {
      const existing = await fsp.readFile(filePath).catch(() => null);
      if (existing && existing.equals(bytes)) return { alreadyExists: true, filePath, sha256: expectedHash };
    }
    throw error;
  }
}

async function describeFile(runRoot, input) {
  const filePath = path.resolve(input.filePath);
  const stat = await fsp.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new RunInputIntegrityError("non_regular_input", `Input no regular: ${input.role}.`);
  }
  return {
    path: portableRelative(runRoot, filePath),
    role: input.role,
    sha256: await sha256File(filePath),
    sizeBytes: stat.size,
  };
}

function productRootPath(options = {}) {
  const runtime = options.productRuntime || getProductRuntime();
  if (options.productRootPath) return options.productRootPath;
  if (!runtime.appPath) return null;
  return path.join(runtime.appPath, "product", PRODUCT_INTEGRITY_ROOT_FILENAME);
}

async function productAnchor(run, options = {}) {
  const selectedRuntime = run.config?.sharedMameRuntime || run.sharedMameRuntime;
  const source = selectedRuntime?.source;
  const executablePath = selectedRuntime?.mameExecutablePath;
  if (source !== "bundled") {
    return {
      mameExecutableSha256: await sha256File(executablePath),
      mode: "developer_external",
      pluginManifestSha256: null,
      productRootSha256: null,
      runtimeManifestSha256: null,
    };
  }
  const rootPath = productRootPath(options);
  if (!rootPath) throw new RunInputIntegrityError("product_root_missing", "No se pudo resolver la raiz app-controlled del producto.");
  const verified = await (options.verifyProductIntegrityRootImpl || verifyProductIntegrityRoot)({
    pluginRoot: run.pluginSourceDir,
    rootPath,
    runtimeRoot: run.mameRuntimeRoot,
  });
  return {
    mameExecutableSha256: verified.runtime.manifest.files.find((entry) => entry.path === "mame.exe")?.sha256 || null,
    mode: "bundled",
    pluginManifestSha256: verified.root.pluginManifestSha256,
    productRootSha256: verified.sha256,
    runtimeManifestSha256: verified.root.runtimeManifestSha256,
  };
}

async function buildRunInputManifest(run, inputs, launchPlan, options = {}) {
  const launchPlanPath = path.join(run.runRoot, LAUNCH_PLAN_FILENAME);
  const launchPlanBytes = canonicalJsonBytes(launchPlan);
  await atomicWriteBytes(launchPlanPath, launchPlanBytes);
  const unique = new Map();
  for (const input of [...inputs, { filePath: launchPlanPath, role: "launch_plan" }]) {
    const relative = portableRelative(run.runRoot, input.filePath);
    if (unique.has(relative)) throw new RunInputIntegrityError("duplicate_input", `Input duplicado: ${relative}.`);
    unique.set(relative, input);
  }
  const files = [];
  for (const relative of [...unique.keys()].sort()) files.push(await describeFile(run.runRoot, unique.get(relative)));
  const manifest = {
    version: 1,
    runId: run.runId,
    packId: run.integrity.packId,
    manifestSha256: run.integrity.manifestSha256,
    mameVersion: run.integrity.mameVersion,
    pluginVersion: run.integrity.pluginVersion,
    launchPlanSha256: sha256Bytes(launchPlanBytes),
    product: await productAnchor(run, options),
    files,
  };
  const manifestPath = path.join(run.runRoot, RUN_INPUT_MANIFEST_FILENAME);
  const bytes = canonicalJsonBytes(manifest);
  await atomicWriteBytes(manifestPath, bytes);
  return { bytes, files, launchPlan, launchPlanPath, manifest, manifestPath, sha256: sha256Bytes(bytes) };
}

function validateManifestShape(manifest, run) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || Object.keys(manifest).sort().join(",") !== "files,launchPlanSha256,mameVersion,manifestSha256,packId,pluginVersion,product,runId,version"
      || manifest.version !== 1 || manifest.runId !== run.runId || manifest.packId !== run.integrity.packId
      || manifest.manifestSha256 !== run.integrity.manifestSha256
      || manifest.mameVersion !== run.integrity.mameVersion || manifest.pluginVersion !== run.integrity.pluginVersion
      || !SHA256_PATTERN.test(manifest.launchPlanSha256 || "") || !Array.isArray(manifest.files)) {
    throw new RunInputIntegrityError("invalid_run_input_manifest", "run-input-manifest.json es invalido o no pertenece a la run.");
  }
  let previous = null;
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join(",") !== "path,role,sha256,sizeBytes"
        || typeof entry.path !== "string" || !entry.path || entry.path.includes("\\") || path.isAbsolute(entry.path)
        || entry.path.split("/").some((part) => !part || part === "." || part === "..")
        || typeof entry.role !== "string" || !entry.role || !SHA256_PATTERN.test(entry.sha256 || "")
        || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || (previous !== null && previous >= entry.path)) {
      throw new RunInputIntegrityError("invalid_run_input_entry", "run-input-manifest contiene una entrada invalida.");
    }
    previous = entry.path;
  }
}

async function verifyPreparedMarker(run) {
  const markerPath = path.join(run.runRoot, PREPARED_MARKER_FILENAME);
  const markerBytes = await fsp.readFile(markerPath);
  const marker = JSON.parse(markerBytes.toString("utf8"));
  if (!marker || Object.keys(marker).sort().join(",") !== "preparedAt,runId,runInputManifestSha256,version"
      || marker.version !== 1 || marker.runId !== run.runId || marker.runInputManifestSha256 !== run.runInputManifestSha256) {
    throw new RunInputIntegrityError("not_prepared", "prepared.marker no acredita esta run.");
  }
  return marker;
}

async function verifyProductAnchor(run, product, options = {}) {
  if (product.mode === "developer_external") {
    const selectedRuntime = run.config?.sharedMameRuntime || run.sharedMameRuntime;
    if (await sha256File(selectedRuntime.mameExecutablePath) !== product.mameExecutableSha256) {
      throw new RunInputIntegrityError("runtime_changed", "mame.exe externo cambio despues de preparar la run.");
    }
    return [];
  }
  if (product.mode !== "bundled") throw new RunInputIntegrityError("invalid_product_anchor", "Anchor de producto desconocida.");
  const rootPath = productRootPath(options);
  const verified = await (options.verifyProductIntegrityRootImpl || verifyProductIntegrityRoot)({
    pluginRoot: run.pluginSourceDir,
    rootPath,
    runtimeRoot: run.mameRuntimeRoot,
  });
  if (verified.sha256 !== product.productRootSha256
      || verified.root.runtimeManifestSha256 !== product.runtimeManifestSha256
      || verified.root.pluginManifestSha256 !== product.pluginManifestSha256) {
    throw new RunInputIntegrityError("product_anchor_changed", "La raiz app-controlled no coincide con el run sellado.");
  }
  return [
    rootPath,
    path.join(run.mameRuntimeRoot, PRODUCT_RUNTIME_INTEGRITY_FILENAME),
    path.join(run.pluginSourceDir, PRODUCT_PLUGIN_INTEGRITY_FILENAME),
    ...verified.runtime.manifest.files.map((entry) => path.join(run.mameRuntimeRoot, ...entry.path.split("/"))),
  ];
}

async function verifyRunInputs(run, options = {}) {
  await verifyPreparedMarker(run);
  const manifestPath = path.join(run.runRoot, RUN_INPUT_MANIFEST_FILENAME);
  const bytes = await fsp.readFile(manifestPath);
  if (sha256Bytes(bytes) !== run.runInputManifestSha256) {
    throw new RunInputIntegrityError("run_input_manifest_changed", "El hash de run-input-manifest no coincide.");
  }
  const manifest = JSON.parse(bytes.toString("utf8"));
  validateManifestShape(manifest, run);
  if (!canonicalJsonBytes(manifest).equals(bytes)) throw new RunInputIntegrityError("noncanonical_run_input_manifest", "run-input-manifest no es canonico.");
  const monitoredPaths = [manifestPath];
  for (const entry of manifest.files) {
    const filePath = path.join(run.runRoot, ...entry.path.split("/"));
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== entry.sizeBytes || await sha256File(filePath) !== entry.sha256) {
      throw new RunInputIntegrityError("run_input_changed", `Input sellado modificado: ${entry.path}.`);
    }
    monitoredPaths.push(filePath);
  }
  const launchPlanBytes = await fsp.readFile(path.join(run.runRoot, LAUNCH_PLAN_FILENAME));
  if (sha256Bytes(launchPlanBytes) !== manifest.launchPlanSha256) {
    throw new RunInputIntegrityError("launch_plan_changed", "El launch plan sellado fue modificado.");
  }
  const launchPlan = JSON.parse(launchPlanBytes.toString("utf8"));
  if (run.launchPlan && !canonicalJsonBytes(run.launchPlan).equals(canonicalJsonBytes(launchPlan))) {
    throw new RunInputIntegrityError("launch_plan_mismatch", "El launch plan verificado no es el que se usara para spawn.");
  }
  monitoredPaths.push(...await verifyProductAnchor(run, manifest.product, options));
  return { launchPlan, manifest, manifestPath, monitoredPaths: [...new Set(monitoredPaths.map((item) => path.resolve(item)))], sha256: sha256Bytes(bytes) };
}

function runInputStatePath(run) {
  return path.join(run.integrityDir, "app", RUN_INPUT_STATE_FILENAME);
}

async function readRunInputState(run) {
  try {
    const value = JSON.parse(await fsp.readFile(runInputStatePath(run), "utf8"));
    if (value?.version !== 1 || value?.runId !== run.runId || !Array.isArray(value.violations)) throw new Error("invalid");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, runId: run.runId, violations: [], updatedAt: null };
    throw new RunInputIntegrityError("run_input_state_invalid", "El estado app-owned de inputs es invalido.");
  }
}

async function recordRunInputViolation(run, code, options = {}) {
  if (!new Set(["run_input_changed", "integrity_unavailable"]).has(code)) throw new Error("Violacion app-owned desconocida.");
  let current;
  try { current = await readRunInputState(run); }
  catch { current = { version: 1, runId: run.runId, violations: ["integrity_unavailable"], updatedAt: null }; }
  const violations = [...new Set([...current.violations, code])];
  const value = { version: 1, runId: run.runId, violations, updatedAt: options.nowIso || new Date().toISOString() };
  await atomicWriteJson(runInputStatePath(run), value);
  return value;
}

async function createRunInputMonitor(run, verified, options = {}) {
  const watchers = [];
  let closed = false;
  let writeChain = Promise.resolve();
  const note = (code) => {
    writeChain = writeChain.then(() => recordRunInputViolation(run, code, options)).catch(() => null);
  };
  try {
    for (const filePath of verified.monitoredPaths) {
      const watcher = (options.watchImpl || fs.watch)(filePath, { persistent: false }, () => note("run_input_changed"));
      watcher.on?.("error", () => note("integrity_unavailable"));
      watchers.push(watcher);
    }
  } catch (error) {
    for (const watcher of watchers) watcher.close?.();
    await recordRunInputViolation(run, "integrity_unavailable", options);
    throw new RunInputIntegrityError("watcher_unavailable", `No se pudo vigilar un input sellado: ${error.message}`);
  }
  return {
    async close() {
      if (closed) return readRunInputState(run);
      closed = true;
      for (const watcher of watchers) watcher.close?.();
      await writeChain;
      return readRunInputState(run);
    },
  };
}

async function verifyRunInputsAfterClose(run, options = {}) {
  try {
    return await verifyRunInputs(run, options);
  } catch (error) {
    await recordRunInputViolation(run, error?.code === "run_input_changed" ? "run_input_changed" : "integrity_unavailable", options);
    return null;
  }
}

async function writePreparingMarker(run, options = {}) {
  const value = { version: 1, runId: run.runId, pid: options.pid || process.pid, createdAt: run.createdAt };
  await atomicWriteBytes(path.join(run.runRoot, PREPARING_MARKER_FILENAME), canonicalJsonBytes(value));
  return value;
}

async function writePreparedMarker(run, options = {}) {
  const value = {
    version: 1,
    runId: run.runId,
    runInputManifestSha256: run.runInputManifestSha256,
    preparedAt: options.nowIso || new Date().toISOString(),
  };
  await atomicWriteBytes(path.join(run.runRoot, PREPARED_MARKER_FILENAME), canonicalJsonBytes(value));
  return value;
}

async function writeMameExitRecord(run, exitCode, options = {}) {
  const value = {
    version: 1,
    runId: run.runId,
    exitCode: Number.isInteger(exitCode) ? exitCode : 1,
    observedAt: options.nowIso || new Date().toISOString(),
  };
  await atomicWriteBytes(path.join(run.integrityDir, MAME_EXIT_FILENAME), canonicalJsonBytes(value));
  return value;
}

module.exports = {
  LAUNCH_PLAN_FILENAME,
  MAME_EXIT_FILENAME,
  PREPARED_MARKER_FILENAME,
  PREPARING_MARKER_FILENAME,
  RUN_INPUT_MANIFEST_FILENAME,
  RUN_INPUT_STATE_FILENAME,
  RunInputIntegrityError,
  atomicWriteBytes,
  buildRunInputManifest,
  canonicalJsonBytes,
  createRunInputMonitor,
  readRunInputState,
  recordRunInputViolation,
  sha256Bytes,
  verifyRunInputs,
  verifyRunInputsAfterClose,
  writeMameExitRecord,
  writePreparedMarker,
  writePreparingMarker,
};
