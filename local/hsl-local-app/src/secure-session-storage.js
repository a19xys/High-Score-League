const fsp = require("node:fs/promises");
const path = require("node:path");

let protectionProvider = null;
let storageDiagnostics = {
  encryptionAvailable: false,
  provider: "plaintext-restricted",
  warning: "secure-provider-not-configured",
};

function configureSessionProtection(provider = null) {
  protectionProvider = provider && typeof provider.encryptString === "function" && typeof provider.decryptString === "function"
    ? provider
    : null;
  storageDiagnostics = protectionProvider
    ? {
        encryptionAvailable: protectionProvider.encryptionAvailable !== false,
        provider: protectionProvider.provider || "system",
        warning: protectionProvider.degraded ? "degraded-storage-backend" : null,
      }
    : {
        encryptionAvailable: false,
        provider: "plaintext-restricted",
        warning: "secure-provider-not-configured",
      };
  return getSessionStorageDiagnostics();
}

function getSessionStorageDiagnostics() {
  return { ...storageDiagnostics };
}

function encodePayload(storedSession) {
  const plain = JSON.stringify(storedSession);
  if (protectionProvider) return protectionProvider.encryptString(plain);
  return Buffer.from(plain, "utf8").toString("base64");
}

function decodePayload(envelope) {
  if (envelope.provider === "plaintext-restricted") {
    return JSON.parse(Buffer.from(envelope.encryptedPayload, "base64").toString("utf8"));
  }
  if (!protectionProvider) {
    throw Object.assign(new Error("El proveedor seguro de esta sesion no esta disponible."), { code: "SESSION_STORAGE_UNAVAILABLE" });
  }
  return JSON.parse(protectionProvider.decryptString(envelope.encryptedPayload));
}

async function readRaw(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw Object.assign(new Error("El material de sesion local esta corrupto."), { code: "SESSION_STORAGE_CORRUPT", cause: error });
  }
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let handle;
  try {
    handle = await fsp.open(tempPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tempPath, filePath);
    await fsp.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await handle?.close().catch(() => {});
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function writeStoredSession(filePath, storedSession, options = {}) {
  const userId = storedSession?.user?.id || null;
  if (!userId || !storedSession?.session?.access_token || !storedSession?.session?.refresh_token) {
    throw Object.assign(new Error("La sesion no contiene identidad y tokens validos."), { code: "SESSION_STORAGE_INVALID" });
  }
  if (options.expectedUserId && options.expectedUserId !== userId) {
    throw Object.assign(new Error("La identidad de sesion no coincide con su cuenta."), { code: "SESSION_IDENTITY_MISMATCH" });
  }
  const previous = await readRaw(filePath).catch(() => null);
  const revision = Number(previous?.revision) > 0 ? Number(previous.revision) + 1 : 1;
  const envelope = {
    encryptedPayload: encodePayload(storedSession),
    playerKey: options.playerKey || null,
    provider: protectionProvider?.provider || "plaintext-restricted",
    revision,
    savedAt: options.savedAt || new Date().toISOString(),
    schemaVersion: 2,
    userId,
  };
  await atomicWriteJson(filePath, envelope);
  const verified = await readStoredSession(filePath, { migrate: false });
  if (verified.storedSession?.user?.id !== userId) {
    throw Object.assign(new Error("No se pudo verificar la sesion persistida."), { code: "SESSION_STORAGE_VERIFY_FAILED" });
  }
  return { envelope, filePath, storage: getSessionStorageDiagnostics() };
}

async function readStoredSession(filePath, options = {}) {
  const raw = await readRaw(filePath);
  if (!raw) return { filePath, status: "missing", storedSession: null, storage: getSessionStorageDiagnostics() };
  if (raw.schemaVersion === 2 && typeof raw.encryptedPayload === "string") {
    const storedSession = decodePayload(raw);
    if (!storedSession?.user?.id || storedSession.user.id !== raw.userId) {
      throw Object.assign(new Error("La identidad del envelope no coincide."), { code: "SESSION_IDENTITY_MISMATCH" });
    }
    return {
      envelope: { ...raw, encryptedPayload: undefined },
      filePath,
      revision: Number(raw.revision) || 1,
      status: "valid",
      storedSession,
      storage: {
        encryptionAvailable: raw.provider !== "plaintext-restricted" && !String(raw.provider).includes("basic_text"),
        provider: raw.provider,
        warning: String(raw.provider).includes("basic_text") ? "degraded-storage-backend" : null,
      },
    };
  }
  if (raw.schemaVersion === 1 && raw.session?.access_token && raw.session?.refresh_token) {
    if (options.migrate !== false && protectionProvider) {
      await writeStoredSession(filePath, raw, { expectedUserId: raw.user?.id });
      return readStoredSession(filePath, { migrate: false });
    }
    return {
      filePath,
      revision: 0,
      status: "legacy-plaintext",
      storedSession: raw,
      storage: { encryptionAvailable: false, provider: "legacy-plaintext" },
    };
  }
  throw Object.assign(new Error("Formato de sesion no reconocido."), { code: "SESSION_STORAGE_CORRUPT" });
}

module.exports = {
  atomicWriteJson,
  configureSessionProtection,
  getSessionStorageDiagnostics,
  readStoredSession,
  writeStoredSession,
};
