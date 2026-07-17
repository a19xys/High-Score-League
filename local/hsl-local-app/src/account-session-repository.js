const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  markAccountRequiresLogin,
  readKnownAccounts,
  rememberAccount,
  setActiveAccount,
} = require("./account-store");
const { acquireFileLock } = require("./file-lock");
const { derivePlayerKey, hashPart } = require("./scoped-queue");
const { atomicWriteJson, getSessionStorageDiagnostics, readStoredSession, writeStoredSession } = require("./secure-session-storage");

const CANONICAL_SCHEMA_VERSION = 3;
const MIGRATION_SCHEMA_VERSION = 1;

function canonicalSessionPath(config, userId) {
  const playerKey = derivePlayerKey({ hasSession: true, userId });
  if (!playerKey) throw new Error("No se pudo derivar la ruta de sesion canonica.");
  return path.join(config.userDataDir, "accounts", "sessions", `${playerKey}.json`);
}

function sessionLockPath(config, userId) {
  const playerKey = derivePlayerKey({ hasSession: true, userId });
  return path.join(config.userDataDir, "accounts", "locks", `session-${playerKey}.lock`);
}

function migrationJournalPath(config) {
  return path.join(config.userDataDir, "accounts", "migration", "canonical-session-v1.json");
}

function safeUserHash(userId) {
  return userId ? `user_${hashPart(userId, 12)}` : null;
}

async function safeSourceHash(filePath) {
  if (!filePath) return null;
  try {
    return crypto.createHash("sha256").update(await fsp.readFile(filePath)).digest("hex").slice(0, 16);
  } catch (error) {
    return error?.code === "ENOENT" ? null : "unreadable";
  }
}

function canonicalPayload(storedSession, revision, source, nowIso) {
  return {
    lastWriteSource: source,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    session: {
      access_token: storedSession.session.access_token,
      expires_at: storedSession.session.expires_at || null,
      expires_in: storedSession.session.expires_in || null,
      refresh_token: storedSession.session.refresh_token,
      token_type: storedSession.session.token_type || "bearer",
    },
    sessionRevision: revision,
    supabaseUrl: storedSession.supabaseUrl || null,
    updatedAt: nowIso,
    user: {
      email: storedSession.user?.email || null,
      id: storedSession.user.id,
    },
  };
}

function validateCanonicalRead(result, expectedUserId) {
  const stored = result?.storedSession;
  if (!stored) return { ...result, ok: false, status: result?.status || "missing" };
  if (stored.user?.id !== expectedUserId) {
    throw Object.assign(new Error("La identidad canonica no coincide."), { code: "SESSION_IDENTITY_MISMATCH", sessionStatus: "revoked" });
  }
  const revision = Number(result.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw Object.assign(new Error("La revision canonica no es valida."), { code: "SESSION_REVISION_INVALID" });
  }
  if (stored.schemaVersion === CANONICAL_SCHEMA_VERSION && Number(stored.sessionRevision) !== revision) {
    throw Object.assign(new Error("La revision del payload no coincide con el envelope."), { code: "SESSION_REVISION_INVALID" });
  }
  return { ...result, ok: true, sessionRevision: revision, status: "valid", storedSession: stored };
}

async function readCandidate(filePath, expectedUserId = null) {
  try {
    const result = await readStoredSession(filePath, { migrate: false });
    if (!result.storedSession) return null;
    if (expectedUserId && result.storedSession.user?.id !== expectedUserId) return { invalid: "identity-mismatch", sourcePath: filePath };
    return {
      expiresAt: Number(result.storedSession.session?.expires_at) || 0,
      revision: Number(result.revision) || 0,
      sourcePath: filePath,
      storedSession: result.storedSession,
      updatedAt: Date.parse(result.storedSession.updatedAt || result.storedSession.savedAt || result.envelope?.savedAt || "") || 0,
    };
  } catch (error) {
    return { error, invalid: "corrupt", sourcePath: filePath };
  }
}

function sameTokens(left, right) {
  return left?.session?.access_token === right?.session?.access_token && left?.session?.refresh_token === right?.session?.refresh_token;
}

function chooseCandidate(candidates) {
  const valid = candidates.filter((candidate) => candidate?.storedSession);
  if (valid.length === 0) return { candidate: null, criterion: "no-valid-source", recoveryRequired: candidates.some(Boolean) };
  if (valid.length === 1) return { candidate: valid[0], criterion: "only-valid-source", recoveryRequired: false };
  const [left, right] = valid;
  if (left.storedSession.user?.id !== right.storedSession.user?.id) return { candidate: null, criterion: "identity-mismatch", recoveryRequired: true };
  if (sameTokens(left.storedSession, right.storedSession)) {
    return { candidate: left.revision >= right.revision ? left : right, criterion: "identical-session", recoveryRequired: false };
  }
  if (left.updatedAt !== right.updatedAt) return { candidate: left.updatedAt > right.updatedAt ? left : right, criterion: "newer-persisted-write", recoveryRequired: false };
  if (left.expiresAt !== right.expiresAt) return { candidate: left.expiresAt > right.expiresAt ? left : right, criterion: "later-expiry", recoveryRequired: false };
  return { candidate: null, criterion: "ambiguous-divergence", recoveryRequired: true };
}

function createAccountSessionRepository(options = {}) {
  const config = options.config || {};
  const inFlight = new Map();
  const operationGenerations = new Map();
  const controllers = new Map();
  const accountStates = new Map();
  const unresolvedUsers = new Set();
  let shuttingDown = false;
  let migrationStatus = "pending";
  let lastMigrationAt = null;
  let accountsCount = 0;
  let activeUserHash = null;
  let legacySessionPresent = false;
  const counters = {
    corruptCount: 0,
    lockTimeoutCount: 0,
    lockWaitCount: 0,
    refreshCount: 0,
    refreshDeferredCount: 0,
    revokedCount: 0,
    sharedRefreshCount: 0,
    staleWriteRejectedCount: 0,
    unresolvedMigrationCount: 0,
  };

  const now = () => options.now ? options.now() : Date.now();
  const nowIso = () => new Date(now()).toISOString();
  const generation = (userId) => operationGenerations.get(userId) || 0;
  const bumpGeneration = (userId) => {
    const next = generation(userId) + 1;
    operationGenerations.set(userId, next);
    controllers.get(userId)?.abort("superseded");
    return next;
  };

  async function read(userId) {
    if (!userId) return { ok: false, status: "missing", storedSession: null };
    if (unresolvedUsers.has(userId)) return { ok: false, status: "recovery-required", storedSession: null };
    try {
      const result = validateCanonicalRead(await readStoredSession(canonicalSessionPath(config, userId), { migrate: false }), userId);
      if (result.ok) accountStates.set(userId, {
        expiresAt: result.storedSession.session?.expires_at || null,
        lastRefreshAt: accountStates.get(userId)?.lastRefreshAt || (result.storedSession.lastWriteSource === "refresh" ? result.storedSession.updatedAt : null),
        requiresLogin: false,
        sessionRevision: result.sessionRevision,
        status: "valid",
      });
      return result;
    } catch (error) {
      counters.corruptCount += 1;
      accountStates.set(userId, { status: error.code === "SESSION_IDENTITY_MISMATCH" ? "revoked" : "corrupt" });
      return { error, ok: false, status: error.code === "SESSION_IDENTITY_MISMATCH" ? "revoked" : "corrupt", storedSession: null };
    }
  }

  async function withUserLock(userId, purpose, operation, lockOptions = {}) {
    let lock;
    try {
      lock = await acquireFileLock(sessionLockPath(config, userId), {
        onWait: () => { counters.lockWaitCount += 1; },
        purpose,
        staleAfterMs: lockOptions.staleAfterMs ?? options.staleAfterMs,
        timeoutMs: lockOptions.timeoutMs ?? options.lockTimeoutMs ?? 30000,
        userHash: safeUserHash(userId),
      });
      return await operation(lock);
    } catch (error) {
      if (error?.code === "SESSION_LOCK_TIMEOUT") {
        counters.lockTimeoutCount += 1;
        counters.refreshDeferredCount += 1;
      }
      throw error;
    } finally {
      await lock?.release();
    }
  }

  async function persist(userId, storedSession, source, expectedRevision) {
    if (storedSession?.user?.id !== userId) {
      throw Object.assign(new Error("La identidad recibida no coincide con la cuenta."), { code: "SESSION_IDENTITY_MISMATCH", sessionStatus: "revoked" });
    }
    const nextRevision = expectedRevision + 1;
    const writtenAt = nowIso();
    const payload = canonicalPayload(storedSession, nextRevision, source, writtenAt);
    const result = await writeStoredSession(canonicalSessionPath(config, userId), payload, {
      atomicWriteImpl: options.atomicWriteImpl,
      expectedRevision,
      expectedUserId: userId,
      playerKey: derivePlayerKey({ hasSession: true, userId }),
      revision: nextRevision,
      savedAt: writtenAt,
    });
    accountStates.set(userId, {
      expiresAt: payload.session.expires_at,
      lastRefreshAt: source === "refresh" ? writtenAt : accountStates.get(userId)?.lastRefreshAt || null,
      requiresLogin: false,
      sessionRevision: nextRevision,
      status: "valid",
    });
    return { ...result, sessionRevision: nextRevision, storedSession: payload };
  }

  async function saveLogin(session, saveOptions = {}) {
    const userId = session?.user?.id || saveOptions.user?.id;
    if (!userId) throw Object.assign(new Error("El login no contiene userId."), { code: "SESSION_IDENTITY_MISSING" });
    bumpGeneration(userId);
    return withUserLock(userId, "login", async () => {
      const resolvingMigration = unresolvedUsers.has(userId);
      let current = resolvingMigration
        ? await readStoredSession(canonicalSessionPath(config, userId), { migrate: false }).catch(() => ({ revision: 0 }))
        : await read(userId);
      if (current.status === "corrupt") {
        await fsp.unlink(canonicalSessionPath(config, userId)).catch(() => {});
        current = { sessionRevision: 0 };
      }
      const storedSession = session.session ? session : {
        schemaVersion: 1,
        session,
        supabaseUrl: config.supabaseUrl,
        user: saveOptions.user,
      };
      const saved = await persist(userId, storedSession, "login", Number(current.sessionRevision ?? current.revision) || 0);
      if (resolvingMigration) {
        unresolvedUsers.delete(userId);
        const legacy = config.sessionFileAbs ? await readCandidate(config.sessionFileAbs) : null;
        if (legacy?.storedSession?.user?.id === userId) await fsp.unlink(config.sessionFileAbs).catch(() => {});
      }
      const store = await rememberAccount(config, {
        email: saved.storedSession.user.email,
        userId,
      }, { requiresLogin: false, sessionRevision: saved.sessionRevision, setActive: saveOptions.setActive !== false });
      accountsCount = store.accounts.length;
      activeUserHash = safeUserHash(store.lastActiveUserId);
      return saved;
    }, { ...saveOptions, timeoutMs: saveOptions.timeoutMs ?? 20000 });
  }

  async function markRevokedUnlocked(userId, reason = "refresh-token-rejected", revision = 0) {
    await fsp.unlink(canonicalSessionPath(config, userId)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    const nextRevision = Math.max(1, Number(revision) + 1);
    const store = await markAccountRequiresLogin(config, userId, { sessionRevision: nextRevision });
    accountsCount = store.accounts.length;
    activeUserHash = safeUserHash(store.lastActiveUserId);
    counters.revokedCount += 1;
    accountStates.set(userId, { requiresLogin: true, sessionRevision: nextRevision, status: "revoked", reason });
    return { sessionRevision: nextRevision, status: "revoked", storedSession: null };
  }

  async function markRevoked(userId, reason = "refresh-token-rejected", revision = 0) {
    return withUserLock(userId, "revoke", () => markRevokedUnlocked(userId, reason, revision));
  }

  async function refreshInternal(userId, refreshOptions = {}) {
    if (shuttingDown) return { status: "deferred", reason: "shutdown", storedSession: null };
    const requestGeneration = generation(userId);
    try {
      return await withUserLock(userId, "refresh", async () => {
        const current = await read(userId);
        if (!current.ok) return current;
        if (!refreshOptions.force && !options.isExpiringSoon(current.storedSession)) return current;
        if (refreshOptions.connected === false || refreshOptions.deferRemote === true) {
          counters.refreshDeferredCount += 1;
          return { ...current, status: "deferred-offline" };
        }
        const controller = new AbortController();
        controllers.set(userId, controller);
        counters.refreshCount += 1;
        let refreshed;
        try {
          refreshed = await options.refreshProvider({
            config,
            signal: controller.signal,
            storedSession: current.storedSession,
            supabaseClient: refreshOptions.supabaseClient,
            userId,
          });
        } catch (error) {
          if (requestGeneration !== generation(userId) || controller.signal.aborted) {
            counters.staleWriteRejectedCount += 1;
            return { error, reason: "stale-refresh", stale: true, status: "deferred", storedSession: null };
          }
          if (error?.sessionStatus === "revoked" || error?.code === "SESSION_IDENTITY_MISMATCH") {
            return markRevokedUnlocked(userId, error.code, current.sessionRevision);
          }
          counters.refreshDeferredCount += 1;
          return { ...current, error, status: "deferred" };
        } finally {
          if (controllers.get(userId) === controller) controllers.delete(userId);
        }
        if (requestGeneration !== generation(userId) || controller.signal.aborted) {
          counters.staleWriteRejectedCount += 1;
          return { ...(await read(userId)), reason: "stale-refresh", stale: true };
        }
        const latest = await read(userId);
        if (latest.sessionRevision !== current.sessionRevision) {
          counters.staleWriteRejectedCount += 1;
          return { ...latest, reason: "stale-revision", stale: true };
        }
        if (refreshed?.user?.id !== userId) return markRevokedUnlocked(userId, "identity-mismatch", current.sessionRevision);
        return persist(userId, refreshed, "refresh", current.sessionRevision);
      }, refreshOptions);
    } catch (error) {
      if (error?.code === "SESSION_LOCK_TIMEOUT") {
        const current = await read(userId);
        return { ...current, error, reason: "lock-timeout", retryable: true, status: "deferred" };
      }
      throw error;
    }
  }

  function refresh(userId, refreshOptions = {}) {
    if (inFlight.has(userId)) {
      counters.sharedRefreshCount += 1;
      return inFlight.get(userId);
    }
    const promise = refreshInternal(userId, refreshOptions).finally(() => inFlight.delete(userId));
    inFlight.set(userId, promise);
    return promise;
  }

  async function resolve(userId, resolveOptions = {}) {
    const current = await read(userId);
    if (!current.ok || !current.storedSession) return current;
    if (!options.isExpiringSoon(current.storedSession) && resolveOptions.force !== true) return current;
    return refresh(userId, resolveOptions);
  }

  function cancelUserOperations(userId, reason = "cancelled") {
    bumpGeneration(userId);
    controllers.get(userId)?.abort(reason);
  }

  function cancelAllOperations(reason = "cancelled") {
    const userIds = new Set([...operationGenerations.keys(), ...inFlight.keys(), ...controllers.keys()]);
    for (const userId of userIds) cancelUserOperations(userId, reason);
  }

  async function remove(userId, removeOptions = {}) {
    cancelUserOperations(userId, removeOptions.reason || "remove-account");
    return withUserLock(userId, "remove", async () => {
      const current = await read(userId);
      await fsp.unlink(canonicalSessionPath(config, userId)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      accountStates.delete(userId);
      return { removed: current.ok, sessionRevision: (Number(current.sessionRevision) || 0) + 1 };
    }, removeOptions);
  }

  async function writeJournal(value) {
    await atomicWriteJson(migrationJournalPath(config), {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      ...value,
    });
  }

  async function readJournal() {
    try {
      return JSON.parse(await fsp.readFile(migrationJournalPath(config), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      return { corrupt: true };
    }
  }

  async function migrateLegacy(migrationOptions = {}) {
    unresolvedUsers.clear();
    counters.unresolvedMigrationCount = 0;
    const journal = await readJournal();
    if (journal?.corrupt) {
      migrationStatus = "recovery-required";
      counters.unresolvedMigrationCount += 1;
      return { status: migrationStatus };
    }
    const legacyPath = config.sessionFileAbs;
    const legacy = legacyPath ? await readCandidate(legacyPath) : null;
    legacySessionPresent = Boolean(legacy);
    const accounts = await readKnownAccounts(config);
    accountsCount = accounts.accounts.length;
    activeUserHash = safeUserHash(accounts.lastActiveUserId || legacy?.storedSession?.user?.id);
    const userIds = new Set(accounts.accounts.map((account) => account.userId));
    if (legacy?.storedSession?.user?.id) userIds.add(legacy.storedSession.user.id);
    const decisions = [];
    migrationStatus = "sources-read";
    if (legacy?.invalid && !legacy?.storedSession?.user?.id) {
      migrationStatus = "recovery-required";
      counters.unresolvedMigrationCount += 1;
    }
    const sourceHashes = {
      active: await safeSourceHash(legacyPath),
      remembered: {},
    };
    for (const userId of userIds) sourceHashes.remembered[safeUserHash(userId)] = await safeSourceHash(canonicalSessionPath(config, userId));
    const startedAt = journal?.startedAt || nowIso();
    await writeJournal({ sourceHashes, startedAt, state: migrationStatus, userHashes: [...userIds].map(safeUserHash) });
    if (migrationOptions.failAfter === "sources-read") throw Object.assign(new Error("Injected migration interruption after sources-read."), { code: "MIGRATION_INTERRUPTED" });

    for (const userId of userIds) {
      const canonicalPath = canonicalSessionPath(config, userId);
      const remembered = await readCandidate(canonicalPath, userId);
      const active = legacy?.storedSession?.user?.id === userId ? legacy : null;
      const decision = chooseCandidate([remembered, active]);
      decisions.push({ criterion: decision.criterion, userHash: safeUserHash(userId) });
      if (decision.recoveryRequired) {
        migrationStatus = "recovery-required";
        unresolvedUsers.add(userId);
        counters.unresolvedMigrationCount += 1;
        continue;
      }
      if (!decision.candidate) continue;
      if (decision.candidate.sourcePath !== canonicalPath || decision.candidate.storedSession.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
        await withUserLock(userId, "migration", async () => {
          const currentRaw = await readStoredSession(canonicalPath, { migrate: false }).catch(() => ({ revision: 0 }));
          const expectedRevision = Number(currentRaw.revision) || 0;
          const nextRevision = expectedRevision + 1;
          const payload = canonicalPayload(decision.candidate.storedSession, nextRevision, "migration", nowIso());
          if (decision.candidate.sourcePath !== canonicalPath) await fsp.unlink(canonicalPath).catch(() => {});
          await writeStoredSession(canonicalPath, payload, {
            expectedRevision: decision.candidate.sourcePath === canonicalPath ? expectedRevision : 0,
            expectedUserId: userId,
            playerKey: derivePlayerKey({ hasSession: true, userId }),
            revision: nextRevision,
          });
          await rememberAccount(config, { email: payload.user.email, userId }, {
            sessionRevision: nextRevision,
            setActive: accounts.lastActiveUserId ? accounts.lastActiveUserId === userId : active !== null,
          });
        }, migrationOptions);
      }
    }

    if (migrationStatus !== "recovery-required") {
      migrationStatus = "canonical-written";
      await writeJournal({ decisions, sourceHashes, startedAt, state: migrationStatus });
      if (migrationOptions.failAfter === "canonical-written") throw Object.assign(new Error("Injected migration interruption after canonical-written."), { code: "MIGRATION_INTERRUPTED" });
      migrationStatus = "canonical-verified";
      await writeJournal({ decisions, sourceHashes, state: migrationStatus, startedAt });
      if (migrationOptions.failAfter === "canonical-verified") throw Object.assign(new Error("Injected migration interruption after canonical-verified."), { code: "MIGRATION_INTERRUPTED" });
      const unlinkLegacy = migrationOptions.unlinkLegacyImpl || fsp.unlink;
      if (legacyPath) await unlinkLegacy(legacyPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      migrationStatus = "legacy-cleaned";
      await writeJournal({ decisions, sourceHashes, state: migrationStatus, startedAt });
      if (migrationOptions.failAfter === "legacy-cleaned") throw Object.assign(new Error("Injected migration interruption after legacy-cleaned."), { code: "MIGRATION_INTERRUPTED" });
      migrationStatus = "completed";
      legacySessionPresent = false;
      lastMigrationAt = nowIso();
      await writeJournal({ completedAt: lastMigrationAt, decisions, sourceHashes, state: migrationStatus, startedAt });
    } else {
      await writeJournal({ decisions, errors: ["ambiguous-session-sources"], sourceHashes, state: migrationStatus, startedAt });
    }
    return { decisions, status: migrationStatus };
  }

  async function getDiagnostics() {
    const accounts = await readKnownAccounts(config);
    accountsCount = accounts.accounts.length;
    activeUserHash = safeUserHash(accounts.lastActiveUserId);
    legacySessionPresent = false;
    try { await fsp.access(config.sessionFileAbs); legacySessionPresent = true; } catch {}
    return {
      ...counters,
      accountsCount: accounts.accounts.length,
      activeUserHash: safeUserHash(accounts.lastActiveUserId),
      canonicalSessionCount: (await Promise.all(accounts.accounts.map((account) => read(account.userId)))).filter((item) => item.ok).length,
      inFlightUserHashes: [...inFlight.keys()].map(safeUserHash),
      lastMigrationAt,
      legacySessionPresent,
      migrationStatus,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sessions: [...accountStates.entries()].map(([userId, state]) => ({ userHash: safeUserHash(userId), ...state })),
      storage: getSessionStorageDiagnostics(),
    };
  }

  function getDiagnosticsSnapshot() {
    return {
      ...counters,
      accountsCount,
      activeUserHash,
      canonicalSessionCount: [...accountStates.values()].filter((state) => state.status === "valid").length,
      inFlightUserHashes: [...inFlight.keys()].map(safeUserHash),
      lastMigrationAt,
      legacySessionPresent,
      migrationStatus,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sessions: [...accountStates.entries()].map(([userId, state]) => ({ userHash: safeUserHash(userId), ...state })),
      storage: getSessionStorageDiagnostics(),
    };
  }

  function shutdown() {
    shuttingDown = true;
    cancelAllOperations("shutdown");
  }

  return {
    cancelAllOperations,
    cancelUserOperations,
    getDiagnostics,
    getDiagnosticsSnapshot,
    markRevoked,
    migrateLegacy,
    read,
    refresh,
    remove,
    resolve,
    saveLogin,
    setActive: (userId, setOptions) => setActiveAccount(config, userId, setOptions),
    shutdown,
  };
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  canonicalPayload,
  canonicalSessionPath,
  chooseCandidate,
  createAccountSessionRepository,
  migrationJournalPath,
  safeUserHash,
  sessionLockPath,
};
