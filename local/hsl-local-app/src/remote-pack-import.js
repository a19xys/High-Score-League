const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");
const { executeCanonicalAuthenticatedRequest } = require("./authenticated-request");
const { executeRemoteRequest, combineAbortSignals } = require("./remote-request");
const { isRemotePackId } = require("./pack-deeplink");
const { verifyCompetitionManifest } = require("./competition-manifest");
const { writePackProvenanceReceipt } = require("./pack-provenance");
const { loadPackFromDir } = require("./pack");
const {
  findInstalledPackByIdForConfig,
  inspectPackZipForProvenance,
} = require("./pack-importer");

const MAX_PACK_DESCRIPTOR_BYTES = 32 * 1024;
const MAX_REMOTE_PACK_BYTES = 1024 * 1024 * 1024;
const DEFAULT_PACK_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

class RemotePackFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RemotePackFailure";
    this.code = code;
  }
}

function failure(code, message) {
  return new RemotePackFailure(code, message);
}

function isLocalArtifactHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/\.$/u, "");
  return value === "localhost"
    || value.endsWith(".localhost")
    || value === "127.0.0.1"
    || value.startsWith("127.")
    || value === "0.0.0.0"
    || value === "[::1]"
    || value === "::1";
}

function validatePackDescriptor(value, requestedPackId, options = {}) {
  const maxPackBytes = Number.isSafeInteger(options.maxPackBytes)
    ? options.maxPackBytes
    : MAX_REMOTE_PACK_BYTES;
  if (!isRemotePackId(requestedPackId)) throw failure("invalid_descriptor", "Invalid requested packId.");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure("invalid_descriptor", "Descriptor must be an object.");
  }
  if (Object.keys(value).sort().join(",") !== "artifact,packId,version") {
    throw failure("invalid_descriptor", "Descriptor contains unsupported fields.");
  }
  if (value.version !== 1 || value.packId !== requestedPackId) {
    throw failure("invalid_descriptor", "Descriptor identity does not match the request.");
  }
  const artifact = value.artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw failure("invalid_descriptor", "Descriptor artifact is missing.");
  }
  if (Object.keys(artifact).sort().join(",") !== "downloadUrl,sha256,sizeBytes") {
    throw failure("invalid_descriptor", "Descriptor artifact contains unsupported fields.");
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0 || artifact.sizeBytes > maxPackBytes) {
    throw failure("invalid_descriptor", "Descriptor size is invalid.");
  }
  if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(artifact.sha256)) {
    throw failure("invalid_descriptor", "Descriptor SHA-256 is invalid.");
  }

  let downloadUrl;
  try {
    downloadUrl = new URL(artifact.downloadUrl);
  } catch {
    throw failure("invalid_descriptor", "Descriptor download URL is invalid.");
  }
  if (
    downloadUrl.protocol !== "https:"
    || downloadUrl.username
    || downloadUrl.password
    || downloadUrl.hash
    || isLocalArtifactHostname(downloadUrl.hostname)
  ) {
    throw failure("invalid_descriptor", "Descriptor download URL is not allowed.");
  }

  return Object.freeze({
    artifact: Object.freeze({
      downloadUrl,
      sha256: artifact.sha256.toLowerCase(),
      sizeBytes: artifact.sizeBytes,
    }),
    packId: requestedPackId,
    version: 1,
  });
}

function packDescriptorEndpoint(hslOrigin, packId) {
  if (!isRemotePackId(packId)) throw failure("invalid_descriptor", "Invalid requested packId.");
  const origin = new URL(hslOrigin);
  return new URL(`/api/launcher/packs/${packId}/download`, origin);
}

function classifyDescriptorHttpStatus(status) {
  if ([404, 410, 503].includes(status)) return "pack-unavailable";
  if (status === 401 || status === 403) return "requires-login";
  return "remote-error";
}

function classifyArtifactHttpStatus(status) {
  if ([404, 410, 503].includes(status)) return "pack-unavailable";
  return "remote-error";
}

async function requestPackDescriptor(options = {}) {
  let endpoint;
  try {
    endpoint = packDescriptorEndpoint(options.hslOrigin, options.packId);
  } catch {
    return { status: "remote-error" };
  }

  let authenticated;
  try {
    authenticated = await executeCanonicalAuthenticatedRequest({
      execute: ({ accessToken }) => executeRemoteRequest({
        fetchImpl: options.fetchImpl,
        init: {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          method: "GET",
        },
        maxResponseBytes: options.maxDescriptorBytes || MAX_PACK_DESCRIPTOR_BYTES,
        redirect: "error",
        responseType: "arrayBuffer",
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        url: endpoint,
      }),
      remoteUsableOptions: { config: options.config, nowMs: options.nowMs },
      resolveSession: options.resolveSession,
    });
  } catch {
    return { status: "remote-error" };
  }

  if (["requires-login", "credential-rejected"].includes(authenticated.status)) {
    return { status: "requires-login" };
  }
  if (authenticated.status !== "response") {
    return {
      status: authenticated.sessionResult?.hasLocalSession === true ? "offline" : "requires-login",
    };
  }

  const request = authenticated.requestResult;
  if (!request?.ok) {
    if (String(request?.technicalReason || "").includes("RESPONSE_TOO_LARGE")) {
      return { status: "remote-error" };
    }
    return { status: request?.failureType === "cancelled" ? "cancelled" : "offline" };
  }
  const httpStatus = Number(request.httpStatus ?? request.response?.status);
  if (httpStatus < 200 || httpStatus >= 300) return { status: classifyDescriptorHttpStatus(httpStatus) };

  try {
    const parsed = JSON.parse(request.bodyBuffer.toString("utf8"));
    return {
      descriptor: validatePackDescriptor(parsed, options.packId, { maxPackBytes: options.maxPackBytes }),
      status: "ready",
    };
  } catch {
    return { status: "remote-error" };
  }
}

async function writeWholeChunk(fileHandle, chunk) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await fileHandle.write(chunk, offset, chunk.byteLength - offset, null);
    if (!result.bytesWritten) throw failure("download_io_failed", "Could not write downloaded artifact.");
    offset += result.bytesWritten;
  }
}

async function cleanupDownloadedArtifact(download) {
  if (download?.tempDir) {
    await fsp.rm(download.tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function downloadPackArtifact(options = {}) {
  const descriptor = options.descriptor;
  const expected = descriptor?.artifact;
  const maxPackBytes = Number.isSafeInteger(options.maxPackBytes)
    ? options.maxPackBytes
    : MAX_REMOTE_PACK_BYTES;
  if (!expected || expected.sizeBytes > maxPackBytes) {
    throw failure("download_integrity_failed", "Artifact exceeds the local size limit.");
  }
  if (options.signal?.aborted) throw failure("cancelled", "Download was cancelled.");

  const tempBaseDir = options.tempBaseDir || os.tmpdir();
  const tempDir = await fsp.mkdtemp(path.join(tempBaseDir, "hsl-pack-"));
  const filePath = path.join(tempDir, `${crypto.randomBytes(12).toString("hex")}.zip`);
  const controller = new AbortController();
  const combined = combineAbortSignals([options.signal, controller.signal]);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_PACK_DOWNLOAD_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("pack-download-timeout");
  }, timeoutMs);
  let fileHandle = null;
  let reader = null;

  try {
    options.onPhase?.("Descargando pack");
    const response = await (options.fetchImpl || fetch)(expected.downloadUrl, {
      headers: { Accept: "application/zip" },
      method: "GET",
      redirect: "error",
      signal: combined.signal,
    });
    const status = Number(response?.status);
    if (response?.redirected === true || (status >= 300 && status < 400)) {
      throw failure("remote_error", "Artifact redirect was rejected.");
    }
    if (status < 200 || status >= 300) {
      throw failure(classifyArtifactHttpStatus(status).replaceAll("-", "_"), "Artifact request failed.");
    }

    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 0 && (
      declaredLength > expected.sizeBytes || declaredLength > maxPackBytes
    )) {
      throw failure("download_integrity_failed", "Declared artifact size is too large.");
    }
    if (!response.body?.getReader) throw failure("remote_error", "Artifact body is not streamable.");

    fileHandle = await fsp.open(filePath, "wx");
    reader = response.body.getReader();
    const hash = crypto.createHash("sha256");
    let bytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > expected.sizeBytes || bytes > maxPackBytes) {
        controller.abort("pack-download-size-limit");
        throw failure("download_integrity_failed", "Downloaded artifact is too large.");
      }
      hash.update(chunk);
      await writeWholeChunk(fileHandle, chunk);
    }

    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;
    options.onPhase?.("Verificando pack");
    const actualSha256 = hash.digest("hex");
    if (bytes !== expected.sizeBytes || actualSha256 !== expected.sha256) {
      throw failure("download_integrity_failed", "Downloaded artifact did not pass verification.");
    }

    return { bytes, filePath, tempDir };
  } catch (error) {
    await reader?.cancel?.("download-failed").catch(() => null);
    if (fileHandle) await fileHandle.close().catch(() => null);
    await cleanupDownloadedArtifact({ tempDir });
    if (error instanceof RemotePackFailure) throw error;
    if (timedOut) throw failure("offline", "Artifact download timed out.");
    if (combined.signal.aborted) throw failure("cancelled", "Artifact download was cancelled.");
    throw failure("offline", "Artifact download failed.");
  } finally {
    clearTimeout(timer);
    combined.dispose();
  }
}

function classifyImporterResult(result) {
  if (result?.ok === true) {
    return result.alreadyInstalled ? "already-installed" : "imported";
  }
  if (result?.code === "duplicate_pack_id") return "already-installed";
  if (result?.code === "destination_collision") return "installation-conflict";
  if (result?.code === "unexpected_pack_id") return "unexpected-pack-id";
  if (["pack_directory_unconfigured", "pack_directory_unavailable"].includes(result?.code)) {
    return "library-unavailable";
  }
  return "invalid-pack";
}

function classifyDownloadFailure(error) {
  const mappings = {
    cancelled: "cancelled",
    duplicate_pack_id: "already-installed",
    destination_collision: "installation-conflict",
    download_integrity_failed: "download-integrity-failed",
    offline: "offline",
    pack_unavailable: "pack-unavailable",
    requires_login: "requires-login",
    remote_error: "remote-error",
    unexpected_pack_id: "unexpected-pack-id",
  };
  if (mappings[error?.code]) return mappings[error.code];
  return "remote-error";
}

async function persistRemoteImportProvenance(options, descriptor, download, importResult) {
  if (importResult?.imported !== true || classifyImporterResult(importResult) !== "imported" || importResult?.alreadyInstalled === true) return null;
  const packRoot = importResult?.pack?.packRoot || importResult?.packDir;
  if (!packRoot) throw failure("remote_error", "Imported pack root is unavailable for provenance verification.");
  const loaded = (options.loadPackFromDirImpl || loadPackFromDir)(packRoot);
  if (!loaded.loaded || loaded.errors?.length > 0 || loaded.pack?.packId !== descriptor.packId) {
    throw failure("remote_error", "Installed pack identity could not be verified for provenance.");
  }
  let manifest;
  try {
    manifest = await (options.verifyCompetitionManifestImpl || verifyCompetitionManifest)(loaded.pack);
  } catch {
    throw failure("remote_error", "Installed competition manifest could not be verified for provenance.");
  }
  return (options.writePackProvenanceReceiptImpl || writePackProvenanceReceipt)(options.config, {
    artifactSha256: descriptor.artifact.sha256,
    artifactSizeBytes: download.bytes,
    competitionManifestSha256: manifest.manifestSha256,
    importedAt: options.importedAt,
    packId: descriptor.packId,
  });
}

async function recoverAlreadyInstalledProvenance(options, descriptor, download) {
  const official = await (options.inspectPackZipForProvenanceImpl || inspectPackZipForProvenance)(
    download.filePath,
    options.config,
    options.importOptions || {},
  );
  if (official.packId !== descriptor.packId) {
    throw failure("unexpected_pack_id", "Official artifact packId does not match the requested pack.");
  }
  const existing = await (options.findInstalledPackByIdImpl || findInstalledPackByIdForConfig)(
    options.config,
    descriptor.packId,
  );
  if (!existing?.packDir) throw failure("remote_error", "The expected installed pack was not found.");
  const loaded = (options.loadPackFromDirImpl || loadPackFromDir)(existing.packDir);
  if (!loaded.loaded || loaded.errors?.length > 0 || loaded.pack?.packId !== descriptor.packId) {
    throw failure("remote_error", "Installed pack identity could not be verified for recovery.");
  }
  let installedManifest = null;
  try {
    installedManifest = await Promise.resolve(
      (options.verifyCompetitionManifestImpl || verifyCompetitionManifest)(loaded.pack),
    );
  } catch {}
  if (!installedManifest || installedManifest.manifestSha256 !== official.competitionManifestSha256) {
    throw failure("remote_error", "Installed pack does not match the verified official artifact.");
  }
  return (options.writePackProvenanceReceiptImpl || writePackProvenanceReceipt)(options.config, {
    artifactSha256: descriptor.artifact.sha256,
    artifactSizeBytes: download.bytes,
    competitionManifestSha256: installedManifest.manifestSha256,
    importedAt: options.importedAt,
    packId: descriptor.packId,
  });
}

async function executeRemotePackImport(options = {}) {
  options.onPhase?.("Preparando pack");
  const descriptorResult = await requestPackDescriptor(options);
  if (descriptorResult.status !== "ready") return descriptorResult;

  let download = null;
  try {
    download = await downloadPackArtifact({
      descriptor: descriptorResult.descriptor,
      fetchImpl: options.fetchImpl,
      maxPackBytes: options.maxPackBytes,
      onPhase: options.onPhase,
      signal: options.signal,
      tempBaseDir: options.tempBaseDir,
      timeoutMs: options.downloadTimeoutMs,
    });
    options.onPhase?.("Importando pack");
    let importResult;
    try {
      importResult = await options.importZip(download.filePath, {
        expectedPackId: options.packId,
      });
    } catch (error) {
      if (!new Set(["duplicate_pack_id", "destination_collision"]).has(error?.code)) throw error;
      importResult = { code: error.code, ok: false, collisionCode: error.code };
    }
    const status = classifyImporterResult(importResult);
    const provenance = status === "imported"
      ? await persistRemoteImportProvenance(options, descriptorResult.descriptor, download, importResult)
      : status === "already-installed"
        ? await recoverAlreadyInstalledProvenance(options, descriptorResult.descriptor, download)
        : null;
    return {
      importResult,
      provenance,
      status,
    };
  } catch (error) {
    return { status: classifyDownloadFailure(error), diagnosticCode: error?.code || error?.name || "Error" };
  } finally {
    await cleanupDownloadedArtifact(download);
  }
}

module.exports = {
  DEFAULT_PACK_DOWNLOAD_TIMEOUT_MS,
  MAX_PACK_DESCRIPTOR_BYTES,
  MAX_REMOTE_PACK_BYTES,
  RemotePackFailure,
  cleanupDownloadedArtifact,
  downloadPackArtifact,
  executeRemotePackImport,
  packDescriptorEndpoint,
  requestPackDescriptor,
  recoverAlreadyInstalledProvenance,
  persistRemoteImportProvenance,
  validatePackDescriptor,
};
