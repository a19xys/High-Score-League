const fsp = require("node:fs/promises");
const path = require("node:path");

const { derivePlayerKey, hashPart } = require("./scoped-queue");
const { atomicWriteJson } = require("./secure-session-storage");

const SESSION_REVISION_SCHEMA_VERSION = 1;
const MAX_SESSION_REVISION = Number.MAX_SAFE_INTEGER - 1;

function safeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function sessionRevisionPath(config, userId) {
  if (!config?.userDataDir) throw new Error("config.userDataDir es obligatorio para las revisiones de sesion.");
  const playerKey = derivePlayerKey({ hasSession: true, userId });
  if (!playerKey) throw Object.assign(new Error("No se pudo derivar la revision de la cuenta."), { code: "SESSION_IDENTITY_MISSING" });
  return path.join(config.userDataDir, "accounts", "session-revisions", `${playerKey}.json`);
}

function userHash(userId) {
  return userId ? `user_${hashPart(userId, 12)}` : null;
}

async function readSessionRevision(config, userId) {
  const filePath = sessionRevisionPath(config, userId);
  try {
    const raw = JSON.parse(await fsp.readFile(filePath, "utf8"));
    if (raw?.schemaVersion !== SESSION_REVISION_SCHEMA_VERSION || raw?.userHash !== userHash(userId)) {
      throw Object.assign(new Error("El ledger de revision no coincide con la cuenta."), { code: "SESSION_REVISION_LEDGER_CORRUPT" });
    }
    const lastRevision = safeRevision(raw.lastRevision);
    if (lastRevision < 1 && raw.lastRevision !== 0) {
      throw Object.assign(new Error("El ledger contiene una revision no valida."), { code: "SESSION_REVISION_LEDGER_CORRUPT" });
    }
    return {
      committed: raw.committed !== false,
      disposition: raw.disposition === "tombstone" ? "tombstone" : "session",
      filePath,
      lastReason: typeof raw.lastReason === "string" ? raw.lastReason : null,
      lastRevision,
      status: "valid",
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { committed: true, disposition: "session", filePath, lastReason: null, lastRevision: 0, status: "missing", updatedAt: null };
    }
    return {
      committed: false,
      disposition: "session",
      error: error?.code === "SESSION_REVISION_LEDGER_CORRUPT"
        ? error
        : Object.assign(new Error("El ledger de revision esta corrupto."), { cause: error, code: "SESSION_REVISION_LEDGER_CORRUPT" }),
      filePath,
      lastReason: null,
      lastRevision: 0,
      status: "corrupt",
      updatedAt: null,
    };
  }
}

function nextRevisionFrom(values) {
  const highest = Math.max(0, ...values.map(safeRevision));
  if (highest >= MAX_SESSION_REVISION) {
    throw Object.assign(new Error("La revision de sesion alcanzo el limite seguro."), { code: "SESSION_REVISION_OVERFLOW" });
  }
  return highest + 1;
}

async function writeRevisionRecord(config, userId, record, options = {}) {
  const filePath = sessionRevisionPath(config, userId);
  const value = {
    committed: record.committed !== false,
    disposition: record.disposition === "tombstone" ? "tombstone" : "session",
    lastReason: typeof record.lastReason === "string" ? record.lastReason.slice(0, 80) : "session-write",
    lastRevision: safeRevision(record.lastRevision),
    schemaVersion: SESSION_REVISION_SCHEMA_VERSION,
    updatedAt: options.now || new Date().toISOString(),
    userHash: userHash(userId),
  };
  if (value.lastRevision < 1) throw Object.assign(new Error("No se puede persistir una revision vacia."), { code: "SESSION_REVISION_INVALID" });
  await (options.atomicWriteImpl || atomicWriteJson)(filePath, value);
  return { ...value, filePath, status: "valid" };
}

async function reserveSessionRevision(config, userId, options = {}) {
  const ledger = await readSessionRevision(config, userId);
  if (ledger.status === "corrupt" && options.allowRecovery !== true) throw ledger.error;
  const revision = nextRevisionFrom([
    ledger.lastRevision,
    ...(Array.isArray(options.observedRevisions) ? options.observedRevisions : []),
  ]);
  return writeRevisionRecord(config, userId, {
    committed: false,
    disposition: options.disposition,
    lastReason: options.reason,
    lastRevision: revision,
  }, options);
}

async function commitSessionRevision(config, userId, revision, options = {}) {
  const ledger = await readSessionRevision(config, userId);
  if (ledger.status === "corrupt" && options.allowRecovery !== true) throw ledger.error;
  const committedRevision = Math.max(safeRevision(revision), ledger.lastRevision);
  if (committedRevision < 1) throw Object.assign(new Error("La revision confirmada no es valida."), { code: "SESSION_REVISION_INVALID" });
  return writeRevisionRecord(config, userId, {
    committed: true,
    disposition: options.disposition || ledger.disposition,
    lastReason: options.reason || ledger.lastReason,
    lastRevision: committedRevision,
  }, options);
}

module.exports = {
  MAX_SESSION_REVISION,
  SESSION_REVISION_SCHEMA_VERSION,
  commitSessionRevision,
  nextRevisionFrom,
  readSessionRevision,
  reserveSessionRevision,
  safeRevision,
  sessionRevisionPath,
};
