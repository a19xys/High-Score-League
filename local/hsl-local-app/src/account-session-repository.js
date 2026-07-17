const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  markAccountRequiresLogin,
  readKnownAccounts,
  rememberAccount,
  removeKnownAccount,
  setActiveAccount,
} = require("./account-store");
const { acquireFileLock } = require("./file-lock");
const { derivePlayerKey, hashPart } = require("./scoped-queue");
const { atomicWriteJson, getSessionStorageDiagnostics, readStoredSession, writeStoredSession } = require("./secure-session-storage");
const {
  createSessionResult,
  isSessionRemoteUsable,
} = require("./session-result");
const {
  createProviderFingerprint,
  createSessionRefreshBackoff,
  evaluateAccessToken,
  evaluateProviderBinding,
} = require("./session-refresh-policy");
const {
  commitSessionRevision,
  readSessionRevision,
  reserveSessionRevision,
} = require("./session-revision-store");

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

function migrationLockPath(config) {
  return path.join(config.userDataDir, "accounts", "locks", "canonical-migration.lock");
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
  const supabaseUrl = storedSession.supabaseUrl || null;
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
    providerFingerprint: createProviderFingerprint(supabaseUrl),
    sessionRevision: revision,
    supabaseUrl,
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
  const activeOperations = new Set();
  const operationGenerations = new Map();
  const controllers = new Map();
  const accountStates = new Map();
  const unresolvedUsers = new Set();
  const policyIdentities = new WeakMap();
  let nextPolicyIdentity = 1;
  const refreshBackoff = createSessionRefreshBackoff({
    maxRetryAfterMs: options.maxRefreshRetryAfterMs,
    now: options.now,
    scheduleMs: options.refreshBackoffScheduleMs,
  });
  let shuttingDown = false;
  let shutdownPromise = null;
  let migrationStatus = "pending";
  let migrationPromise = null;
  let lastMigrationAt = null;
  let accountsCount = 0;
  let activeUserHash = null;
  let legacySessionPresent = false;
  const counters = {
    corruptCount: 0,
    lockTimeoutCount: 0,
    lockWaitCount: 0,
    refreshBackoffCount: 0,
    refreshCount: 0,
    refreshDeferredCount: 0,
    revokedCount: 0,
    sharedRefreshCount: 0,
    staleWriteRejectedCount: 0,
    unresolvedMigrationCount: 0,
  };

  const now = () => options.now ? Number(options.now()) : Date.now();
  const nowIso = () => new Date(now()).toISOString();
  const generation = (userId) => operationGenerations.get(userId) || 0;
  const result = (status, details = {}) => createSessionResult({ status, ...details });

  function policyIdentity(value) {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return null;
    if (!policyIdentities.has(value)) policyIdentities.set(value, nextPolicyIdentity++);
    return policyIdentities.get(value);
  }

  function track(promise) {
    activeOperations.add(promise);
    promise.finally(() => activeOperations.delete(promise)).catch(() => {});
    return promise;
  }

  function registerController(userId, controller) {
    const current = controllers.get(userId) || new Set();
    current.add(controller);
    controllers.set(userId, current);
  }

  function unregisterController(userId, controller) {
    const current = controllers.get(userId);
    if (!current) return;
    current.delete(controller);
    if (current.size === 0) controllers.delete(userId);
  }

  function abortUserControllers(userId, reason) {
    for (const controller of controllers.get(userId) || []) controller.abort(reason);
  }

  function bumpGeneration(userId, reason = "superseded") {
    const next = generation(userId) + 1;
    operationGenerations.set(userId, next);
    abortUserControllers(userId, reason);
    return next;
  }

  function assessStoredSession(storedSession, userId) {
    const providerBinding = evaluateProviderBinding({
      config,
      storedFingerprint: storedSession?.providerFingerprint,
      storedSession,
    });
    const token = evaluateAccessToken(storedSession, {
      absoluteUsabilitySeconds: options.absoluteUsabilitySeconds,
      expectedUserId: userId,
      nowMs: now(),
      providerBinding,
      refreshThresholdSeconds: options.refreshThresholdSeconds,
    });
    return { providerBinding, token };
  }

  function resultFromStored(storedSession, sessionRevision, preferredStatus = "valid", details = {}) {
    const userId = storedSession?.user?.id;
    const assessment = assessStoredSession(storedSession, userId);
    if (!assessment.providerBinding.matches) {
      return result("provider-mismatch", {
        ...details,
        hasLocalSession: true,
        reason: assessment.providerBinding.reason,
        sessionRevision,
        storedSession,
      });
    }
    if (!assessment.token.remoteUsable) {
      return result("deferred", {
        ...details,
        hasLocalSession: true,
        reason: assessment.token.reason,
        remoteUsable: false,
        sessionRevision,
        storedSession,
      });
    }
    return result(preferredStatus, {
      ...details,
      hasLocalSession: true,
      reason: details.reason || preferredStatus,
      remoteUsable: true,
      sessionRevision,
      storedSession,
    });
  }

  async function inspectCanonical(userId) {
    try {
      const raw = await readStoredSession(canonicalSessionPath(config, userId), { migrate: false });
      if (!raw.storedSession) return { fileRevision: 0, kind: "missing", raw };
      const validated = validateCanonicalRead(raw, userId);
      return { fileRevision: Number(raw.revision) || 0, kind: "valid", raw, validated };
    } catch (error) {
      return {
        error,
        fileRevision: Number(error?.currentRevision) || 0,
        kind: error?.code === "SESSION_STORAGE_UNAVAILABLE" ? "storage-unavailable" : "corrupt",
      };
    }
  }

  async function accountStorePreflight(userId) {
    const store = await readKnownAccounts(config);
    if (store.corrupt) {
      throw Object.assign(new Error("known-accounts.json esta corrupto; no se modifica la sesion."), { code: "KNOWN_ACCOUNTS_CORRUPT" });
    }
    return {
      account: store.accounts.find((item) => item.userId === userId) || null,
      store,
    };
  }

  async function read(userId) {
    if (!userId) return result("missing", { reason: "identity-missing" });
    const ledger = await readSessionRevision(config, userId);
    if (ledger.status === "corrupt") {
      counters.corruptCount += 1;
      return result("recovery-required", { error: ledger.error, migrationRequired: true, reason: "revision-ledger-corrupt" });
    }
    if (unresolvedUsers.has(userId)) {
      return result("recovery-required", {
        hasLocalSession: true,
        migrationRequired: true,
        reason: "ambiguous-session-sources",
        sessionRevision: ledger.lastRevision,
      });
    }
    const inspected = await inspectCanonical(userId);
    if (inspected.kind === "missing") {
      const revoked = ledger.disposition === "tombstone" && String(ledger.lastReason || "").includes("revok");
      return result(revoked ? "revoked" : "missing", {
        reason: ledger.lastReason || "canonical-session-missing",
        sessionRevision: ledger.lastRevision,
      });
    }
    if (inspected.kind === "storage-unavailable") {
      return result("storage-unavailable", {
        error: inspected.error,
        hasLocalSession: true,
        reason: "secure-storage-unavailable",
        sessionRevision: ledger.lastRevision,
      });
    }
    if (inspected.kind === "corrupt") {
      counters.corruptCount += 1;
      accountStates.set(userId, { sessionRevision: ledger.lastRevision, status: "corrupt" });
      return result("corrupt", {
        error: inspected.error,
        hasLocalSession: true,
        reason: inspected.error?.code || "canonical-session-corrupt",
        sessionRevision: ledger.lastRevision,
      });
    }
    const canonicalRevision = inspected.validated.sessionRevision;
    if (ledger.disposition === "tombstone" && ledger.lastRevision > canonicalRevision) {
      const revoked = String(ledger.lastReason || "").includes("revok");
      return result(revoked ? "revoked" : "missing", {
        reason: ledger.lastReason || "pending-secret-removal",
        sessionRevision: ledger.lastRevision,
      });
    }
    const canonical = resultFromStored(inspected.validated.storedSession, canonicalRevision);
    accountStates.set(userId, {
      expiresAt: inspected.validated.storedSession.session?.expires_at || null,
      lastRefreshAt: accountStates.get(userId)?.lastRefreshAt || (inspected.validated.storedSession.lastWriteSource === "refresh" ? inspected.validated.storedSession.updatedAt : null),
      requiresLogin: canonical.requiresLogin,
      sessionRevision: canonical.sessionRevision,
      status: canonical.status,
    });
    return canonical;
  }

  async function withUserLock(userId, purpose, operation, lockOptions = {}) {
    let lock;
    try {
      lock = await acquireFileLock(sessionLockPath(config, userId), {
        onWait: () => { counters.lockWaitCount += 1; },
        purpose,
        signal: lockOptions.signal,
        staleAfterMs: lockOptions.staleAfterMs ?? options.staleAfterMs,
        timeoutMs: lockOptions.timeoutMs ?? options.lockTimeoutMs ?? 30000,
        userHash: safeUserHash(userId),
      });
      return await operation(lock);
    } catch (error) {
      if (error?.code === "SESSION_LOCK_TIMEOUT") {
        counters.lockTimeoutCount += 1;
        if (purpose === "refresh") counters.refreshDeferredCount += 1;
      }
      throw error;
    } finally {
      await lock?.release();
    }
  }

  async function persistUnlocked(userId, storedSession, source, inspected, storePreflight, persistOptions = {}) {
    if (storedSession?.user?.id !== userId) {
      throw Object.assign(new Error("La identidad recibida no coincide con la cuenta."), { code: "SESSION_IDENTITY_MISMATCH", sessionStatus: "revoked" });
    }
    if (inspected.kind === "storage-unavailable") throw inspected.error;
    const observedRevisions = [
      inspected.kind === "valid" ? inspected.validated.sessionRevision : inspected.fileRevision,
      storePreflight.account?.sessionRevision,
    ];
    const reserved = await reserveSessionRevision(config, userId, {
      allowRecovery: persistOptions.allowRecovery === true,
      disposition: "session",
      now: nowIso(),
      observedRevisions,
      reason: source,
    });
    const nextRevision = reserved.lastRevision;
    const writtenAt = nowIso();
    const completeSession = { ...storedSession, supabaseUrl: config.supabaseUrl };
    const payload = canonicalPayload(completeSession, nextRevision, source, writtenAt);
    if (inspected.kind === "corrupt") {
      await safeSourceHash(canonicalSessionPath(config, userId));
      await fsp.unlink(canonicalSessionPath(config, userId)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
    await writeStoredSession(canonicalSessionPath(config, userId), payload, {
      atomicWriteImpl: options.atomicWriteImpl,
      expectedRevision: inspected.kind === "valid" ? inspected.fileRevision : 0,
      expectedUserId: userId,
      playerKey: derivePlayerKey({ hasSession: true, userId }),
      revision: nextRevision,
      savedAt: writtenAt,
    });
    await commitSessionRevision(config, userId, nextRevision, {
      allowRecovery: persistOptions.allowRecovery === true,
      disposition: "session",
      now: writtenAt,
      reason: source,
    });
    const store = await rememberAccount(config, {
      email: payload.user.email,
      userId,
    }, {
      requiresLogin: false,
      sessionRevision: nextRevision,
      setActive: persistOptions.setActive,
    });
    accountsCount = store.accounts.length;
    activeUserHash = safeUserHash(store.lastActiveUserId);
    accountStates.set(userId, {
      expiresAt: payload.session.expires_at,
      lastRefreshAt: source === "refresh" ? writtenAt : accountStates.get(userId)?.lastRefreshAt || null,
      requiresLogin: false,
      sessionRevision: nextRevision,
      status: source === "refresh" ? "refreshed" : "valid",
    });
    return resultFromStored(payload, nextRevision, source === "refresh" ? "refreshed" : "valid");
  }

  async function finalizeRecoveryAfterLogin(userId) {
    const journal = await readJournal();
    if (!unresolvedUsers.has(userId) && !journal?.corrupt && journal?.state !== "recovery-required") return;
    let lock;
    try {
      lock = await acquireFileLock(migrationLockPath(config), {
        purpose: "canonical-migration-recovery",
        timeoutMs: options.migrationLockTimeoutMs ?? 30000,
      });
      const legacy = config.sessionFileAbs ? await readCandidate(config.sessionFileAbs) : null;
      if (!legacy?.storedSession || legacy.storedSession.user?.id === userId || legacy.invalid === "corrupt") {
        if (config.sessionFileAbs) await fsp.unlink(config.sessionFileAbs).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      }
      unresolvedUsers.delete(userId);
      await migrateLegacyUnlocked({ allowJournalRecovery: true });
    } finally {
      await lock?.release();
    }
  }

  async function saveLogin(session, saveOptions = {}) {
    const userId = session?.user?.id || saveOptions.user?.id;
    if (!userId) throw Object.assign(new Error("El login no contiene userId."), { code: "SESSION_IDENTITY_MISSING" });
    if (shuttingDown) throw Object.assign(new Error("El repositorio de sesiones se esta cerrando."), { code: "SESSION_REPOSITORY_SHUTDOWN" });
    bumpGeneration(userId, "login");
    refreshBackoff.recordLogin(userId);
    const operation = (async () => {
      const saved = await withUserLock(userId, "login", async () => {
        const preflight = await accountStorePreflight(userId);
        const inspected = await inspectCanonical(userId);
        const storedSession = session.session ? session : {
          schemaVersion: 1,
          session,
          supabaseUrl: config.supabaseUrl,
          user: saveOptions.user,
        };
        return persistUnlocked(userId, storedSession, "login", inspected, preflight, {
          allowRecovery: inspected.kind === "corrupt" || unresolvedUsers.has(userId),
          setActive: saveOptions.setActive !== false,
        });
      }, { ...saveOptions, timeoutMs: saveOptions.timeoutMs ?? 20000 });
      await finalizeRecoveryAfterLogin(userId);
      return saved;
    })();
    return track(operation);
  }

  async function reserveTombstoneUnlocked(userId, reason, inspected, preflight, revision = 0) {
    const reserved = await reserveSessionRevision(config, userId, {
      disposition: "tombstone",
      now: nowIso(),
      observedRevisions: [
        revision,
        inspected.kind === "valid" ? inspected.validated.sessionRevision : inspected.fileRevision,
        preflight.account?.sessionRevision,
      ],
      reason,
    });
    await fsp.unlink(canonicalSessionPath(config, userId)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await commitSessionRevision(config, userId, reserved.lastRevision, {
      disposition: "tombstone",
      now: nowIso(),
      reason,
    });
    return reserved.lastRevision;
  }

  async function markRevokedUnlocked(userId, reason = "refresh-token-rejected", revision = 0, supplied = {}) {
    const preflight = supplied.preflight || await accountStorePreflight(userId);
    const inspected = supplied.inspected || await inspectCanonical(userId);
    const nextRevision = await reserveTombstoneUnlocked(userId, `revoked:${reason}`, inspected, preflight, revision);
    const store = await markAccountRequiresLogin(config, userId, { sessionRevision: nextRevision });
    accountsCount = store.accounts.length;
    activeUserHash = safeUserHash(store.lastActiveUserId);
    counters.revokedCount += 1;
    accountStates.set(userId, { requiresLogin: true, sessionRevision: nextRevision, status: "revoked", reason });
    return result("revoked", { reason, sessionRevision: nextRevision });
  }

  function markRevoked(userId, reason = "refresh-token-rejected", revision = 0) {
    if (shuttingDown) return Promise.resolve(result("cancelled", { reason: "shutdown" }));
    bumpGeneration(userId, reason);
    return track(withUserLock(userId, "revoke", () => markRevokedUnlocked(userId, reason, revision)));
  }

  function raceProviderWithAbort(providerPromise, signal) {
    if (signal.aborted) return Promise.reject(Object.assign(new Error("Session operation cancelled."), { code: "SESSION_OPERATION_CANCELLED", name: "AbortError" }));
    let listener;
    const cancellation = new Promise((_, reject) => {
      listener = () => reject(Object.assign(new Error("Session operation cancelled."), {
        code: "SESSION_OPERATION_CANCELLED",
        name: "AbortError",
        reason: signal.reason,
      }));
      signal.addEventListener("abort", listener, { once: true });
    });
    return Promise.race([Promise.resolve(providerPromise), cancellation])
      .finally(() => signal.removeEventListener("abort", listener));
  }

  async function refreshInternal(userId, refreshOptions, requestGeneration, baseSessionRevision) {
    if (shuttingDown) return result("cancelled", { reason: "shutdown" });
    const controller = new AbortController();
    const callerSignal = refreshOptions.signal;
    const abortFromCaller = () => controller.abort(callerSignal.reason || "caller-cancelled");
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    registerController(userId, controller);
    try {
      try {
        return await withUserLock(userId, "refresh", async () => {
        const current = await read(userId);
        if (shuttingDown || requestGeneration !== generation(userId) || controller.signal.aborted) {
          const superseded = requestGeneration !== generation(userId);
          const status = shuttingDown || !superseded ? "cancelled" : "stale";
          if (status === "stale") counters.staleWriteRejectedCount += 1;
          return result(status, {
            hasLocalSession: current.hasLocalSession,
            reason: shuttingDown ? "shutdown" : String(controller.signal.reason || (superseded ? "stale-refresh" : "caller-cancelled")),
            sessionRevision: current.sessionRevision,
            stale: status === "stale",
            storedSession: current.storedSession,
          });
        }
        if (!current.hasLocalSession || !current.storedSession || current.requiresLogin) return current;
        if (baseSessionRevision && current.sessionRevision !== baseSessionRevision) {
          counters.staleWriteRejectedCount += 1;
          return result("stale", {
            hasLocalSession: current.hasLocalSession,
            reason: "base-revision-superseded",
            sessionRevision: current.sessionRevision,
            stale: true,
            storedSession: current.storedSession,
          });
        }
        const assessment = assessStoredSession(current.storedSession, userId);
        const expiringSoon = options.isExpiringSoon
          ? options.isExpiringSoon(current.storedSession)
          : assessment.token.shouldRefresh;
        if (!refreshOptions.force && !expiringSoon) return current;
        if (refreshOptions.connected === false || refreshOptions.deferRemote === true) {
          counters.refreshDeferredCount += 1;
          return result("deferred", {
            hasLocalSession: true,
            reason: refreshOptions.deferRemote ? "remote-deferred-by-caller" : "offline",
            remoteUsable: assessment.token.remoteUsable,
            sessionRevision: current.sessionRevision,
            storedSession: current.storedSession,
          });
        }
        const eligibility = refreshBackoff.canAttempt(userId);
        if (!eligibility.allowed && refreshOptions.bypassBackoff !== true) {
          counters.refreshBackoffCount += 1;
          return result("deferred", {
            hasLocalSession: true,
            reason: "refresh-backoff",
            remoteUsable: assessment.token.remoteUsable,
            retryAfterMs: eligibility.retryAfterMs,
            sessionRevision: current.sessionRevision,
            storedSession: current.storedSession,
          });
        }
        const preflight = await accountStorePreflight(userId);
        const inspected = await inspectCanonical(userId);
        counters.refreshCount += 1;
        let refreshed;
        try {
          refreshed = await raceProviderWithAbort(options.refreshProvider({
            config,
            fetchImpl: refreshOptions.fetchImpl,
            signal: controller.signal,
            storedSession: current.storedSession,
            supabaseClient: refreshOptions.supabaseClient,
            timeoutMs: refreshOptions.timeoutMs,
            userId,
          }), controller.signal);
        } catch (error) {
          if (requestGeneration !== generation(userId) || controller.signal.aborted) {
            counters.staleWriteRejectedCount += 1;
            const superseded = requestGeneration !== generation(userId);
            const status = shuttingDown || !superseded ? "cancelled" : "stale";
            return result(status, {
              error,
              hasLocalSession: true,
              reason: shuttingDown ? "shutdown" : String(controller.signal.reason || (superseded ? "stale-refresh" : "caller-cancelled")),
              sessionRevision: current.sessionRevision,
              stale: status === "stale",
              storedSession: current.storedSession,
            });
          }
          if (error?.sessionStatus === "revoked" || error?.code === "SESSION_IDENTITY_MISMATCH") {
            return markRevokedUnlocked(userId, error.code || "identity-mismatch", current.sessionRevision, { inspected, preflight });
          }
          const backoff = refreshBackoff.recordFailure(userId, {
            error,
            failureType: error?.failureType,
            reason: error?.refreshReason || error?.code,
            retryAfterMs: error?.retryAfterMs,
            retryable: error?.transient !== false,
            status: error?.status,
          });
          counters.refreshDeferredCount += 1;
          const postFailureAssessment = assessStoredSession(current.storedSession, userId);
          return result("deferred", {
            error,
            hasLocalSession: true,
            reason: error?.refreshReason || error?.code || "refresh-temporary-failure",
            remoteUsable: postFailureAssessment.token.remoteUsable,
            retryAfterMs: backoff.state?.retryAfterMs,
            sessionRevision: current.sessionRevision,
            storedSession: current.storedSession,
          });
        }
        if (requestGeneration !== generation(userId) || controller.signal.aborted) {
          counters.staleWriteRejectedCount += 1;
          return result("stale", {
            hasLocalSession: true,
            reason: "stale-refresh",
            sessionRevision: current.sessionRevision,
            stale: true,
            storedSession: current.storedSession,
          });
        }
        if (refreshed?.user?.id !== userId) {
          return markRevokedUnlocked(userId, "identity-mismatch", current.sessionRevision, { inspected, preflight });
        }
        const saved = await persistUnlocked(userId, refreshed, "refresh", inspected, preflight, { setActive: false });
        refreshBackoff.recordSuccess(userId);
        return saved;
        }, { ...refreshOptions, signal: controller.signal });
      } catch (error) {
        if (error?.code === "SESSION_LOCK_TIMEOUT") {
          const current = await read(userId);
          return result("lock-timeout", {
            error,
            hasLocalSession: current.hasLocalSession,
            lockState: { status: "timeout", timeoutMs: refreshOptions.timeoutMs ?? options.lockTimeoutMs ?? 30000 },
            reason: "lock-timeout",
            sessionRevision: current.sessionRevision,
            storedSession: current.storedSession,
          });
        }
        if (error?.code === "SESSION_LOCK_ABORTED") {
          const current = await read(userId);
          const superseded = requestGeneration !== generation(userId);
          const status = shuttingDown || !superseded ? "cancelled" : "stale";
          if (status === "stale") counters.staleWriteRejectedCount += 1;
          return result(status, {
            error,
            hasLocalSession: current.hasLocalSession,
            reason: shuttingDown ? "shutdown" : String(controller.signal.reason || "lock-wait-cancelled"),
            sessionRevision: current.sessionRevision,
            stale: status === "stale",
            storedSession: current.storedSession,
          });
        }
        throw error;
      }
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
      unregisterController(userId, controller);
    }
  }

  function refresh(userId, refreshOptions = {}) {
    if (shuttingDown) return Promise.resolve(result("cancelled", { reason: "shutdown" }));
    const requestGeneration = generation(userId);
    const baseSessionRevision = Number(refreshOptions.baseSessionRevision) || 0;
    const policyKey = JSON.stringify({
      bypassBackoff: refreshOptions.bypassBackoff === true,
      connected: refreshOptions.connected !== false,
      deferRemote: refreshOptions.deferRemote === true,
      fetchImpl: policyIdentity(refreshOptions.fetchImpl),
      force: refreshOptions.force === true,
      signal: policyIdentity(refreshOptions.signal),
      supabaseClient: policyIdentity(refreshOptions.supabaseClient),
      timeoutMs: Number.isFinite(refreshOptions.timeoutMs) ? refreshOptions.timeoutMs : null,
    });
    const existing = inFlight.get(userId);
    if (existing && existing.generation === requestGeneration && existing.baseSessionRevision === baseSessionRevision && existing.policyKey === policyKey) {
      counters.sharedRefreshCount += 1;
      return existing.promise;
    }
    const entry = { baseSessionRevision, generation: requestGeneration, policyKey, promise: null };
    entry.promise = track(refreshInternal(userId, refreshOptions, requestGeneration, baseSessionRevision))
      .finally(() => {
        if (inFlight.get(userId) === entry) inFlight.delete(userId);
      });
    inFlight.set(userId, entry);
    return entry.promise;
  }

  async function resolve(userId, resolveOptions = {}) {
    if (shuttingDown) return result("cancelled", { reason: "shutdown" });
    const current = await read(userId);
    if (!current.hasLocalSession || !current.storedSession || current.requiresLogin) return current;
    const assessment = assessStoredSession(current.storedSession, userId);
    const expiringSoon = options.isExpiringSoon
      ? options.isExpiringSoon(current.storedSession)
      : assessment.token.shouldRefresh;
    if (!expiringSoon && resolveOptions.force !== true) return current;
    return refresh(userId, { ...resolveOptions, baseSessionRevision: current.sessionRevision });
  }

  function cancelUserOperations(userId, reason = "cancelled") {
    bumpGeneration(userId, reason);
  }

  function cancelAllOperations(reason = "cancelled") {
    const userIds = new Set([...operationGenerations.keys(), ...inFlight.keys(), ...controllers.keys()]);
    for (const userId of userIds) cancelUserOperations(userId, reason);
  }

  function remove(userId, removeOptions = {}) {
    if (shuttingDown) return Promise.resolve({ ...result("cancelled", { reason: "shutdown" }), removed: false });
    cancelUserOperations(userId, removeOptions.reason || "remove-account");
    refreshBackoff.reset(userId);
    return track(withUserLock(userId, "remove", async () => {
      const preflight = await accountStorePreflight(userId);
      const inspected = await inspectCanonical(userId);
      const nextRevision = await reserveTombstoneUnlocked(
        userId,
        removeOptions.reason || "remove-account",
        inspected,
        preflight,
      );
      let metadataRemoved = false;
      if (removeOptions.forgetAccount === true) {
        const removal = await removeKnownAccount(config, userId, { deleteSession: false });
        metadataRemoved = removal.removed === true;
      } else if (preflight.account) {
        await rememberAccount(config, { userId }, {
          requiresLogin: false,
          sessionRevision: nextRevision,
          setActive: false,
        });
      }
      accountStates.delete(userId);
      return {
        ...result("missing", { reason: removeOptions.reason || "removed", sessionRevision: nextRevision }),
        removed: inspected.kind !== "missing" || metadataRemoved,
      };
    }, removeOptions));
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

  async function migrateLegacyUnlocked(migrationOptions = {}) {
    unresolvedUsers.clear();
    counters.unresolvedMigrationCount = 0;
    const journal = await readJournal();
    if (journal?.corrupt && migrationOptions.allowJournalRecovery !== true) {
      migrationStatus = "recovery-required";
      counters.unresolvedMigrationCount += 1;
      return { status: migrationStatus };
    }
    if (journal?.state === "completed" && migrationOptions.force !== true) {
      migrationStatus = "completed";
      lastMigrationAt = typeof journal.completedAt === "string" ? journal.completedAt : lastMigrationAt;
      try {
        await fsp.access(config.sessionFileAbs);
        legacySessionPresent = true;
      } catch {
        legacySessionPresent = false;
      }
      return { ignoredReappearedLegacy: legacySessionPresent, status: migrationStatus };
    }
    const legacyPath = config.sessionFileAbs;
    const legacy = legacyPath ? await readCandidate(legacyPath) : null;
    legacySessionPresent = Boolean(legacy);
    const accounts = await readKnownAccounts(config);
    if (accounts.corrupt) {
      migrationStatus = "recovery-required";
      counters.unresolvedMigrationCount += 1;
      return { status: migrationStatus };
    }
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
    const startedAt = journal?.corrupt ? nowIso() : journal?.startedAt || nowIso();
    await writeJournal({ sourceHashes, startedAt, state: migrationStatus, userHashes: [...userIds].map(safeUserHash) });
    if (migrationOptions.failAfter === "sources-read") throw Object.assign(new Error("Injected migration interruption after sources-read."), { code: "MIGRATION_INTERRUPTED" });

    for (const userId of userIds) {
      const canonicalPath = canonicalSessionPath(config, userId);
      await withUserLock(userId, "migration", async () => {
        const remembered = await readCandidate(canonicalPath, userId);
        const active = legacy?.storedSession?.user?.id === userId ? await readCandidate(legacyPath, userId) : null;
        const decision = chooseCandidate([remembered, active]);
        decisions.push({ criterion: decision.criterion, userHash: safeUserHash(userId) });
        if (decision.recoveryRequired) {
          migrationStatus = "recovery-required";
          unresolvedUsers.add(userId);
          counters.unresolvedMigrationCount += 1;
          return;
        }
        if (!decision.candidate) return;
        const binding = evaluateProviderBinding({ config, storedSession: decision.candidate.storedSession });
        if (!binding.matches) {
          migrationStatus = "recovery-required";
          unresolvedUsers.add(userId);
          counters.unresolvedMigrationCount += 1;
          decisions[decisions.length - 1] = { criterion: "provider-mismatch", userHash: safeUserHash(userId) };
          return;
        }
        const inspected = await inspectCanonical(userId);
        const preflight = await accountStorePreflight(userId);
        if (decision.candidate.sourcePath !== canonicalPath || decision.candidate.storedSession.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
          await persistUnlocked(userId, decision.candidate.storedSession, "migration", inspected, preflight, {
            allowRecovery: inspected.kind === "corrupt",
            setActive: accounts.lastActiveUserId ? accounts.lastActiveUserId === userId : active !== null,
          });
        } else {
          await commitSessionRevision(config, userId, decision.candidate.revision, {
            disposition: "session",
            now: nowIso(),
            reason: "migration-verified",
          });
          await rememberAccount(config, { email: decision.candidate.storedSession.user?.email, userId }, {
            sessionRevision: decision.candidate.revision,
            setActive: accounts.lastActiveUserId === userId,
          });
        }
      }, migrationOptions);
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

  function migrateLegacy(migrationOptions = {}) {
    if (shuttingDown) return Promise.resolve({ status: "cancelled" });
    if (migrationPromise) return migrationPromise;
    const operation = (async () => {
      let lock;
      try {
        lock = await acquireFileLock(migrationLockPath(config), {
          purpose: "canonical-migration",
          signal: migrationOptions.signal,
          staleAfterMs: migrationOptions.staleAfterMs ?? options.staleAfterMs,
          timeoutMs: migrationOptions.timeoutMs ?? options.migrationLockTimeoutMs ?? 30000,
        });
        return await migrateLegacyUnlocked(migrationOptions);
      } finally {
        await lock?.release();
      }
    })();
    migrationPromise = track(operation).finally(() => {
      migrationPromise = null;
    });
    return migrationPromise;
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
      refreshBackoff: refreshBackoff.getDiagnostics(),
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
      refreshBackoff: refreshBackoff.getDiagnostics(),
      inFlightUserHashes: [...inFlight.keys()].map(safeUserHash),
      lastMigrationAt,
      legacySessionPresent,
      migrationStatus,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sessions: [...accountStates.entries()].map(([userId, state]) => ({ userHash: safeUserHash(userId), ...state })),
      storage: getSessionStorageDiagnostics(),
    };
  }

  async function waitForOperations(waitOptions = {}) {
    const timeoutMs = Number.isFinite(waitOptions.timeoutMs) && waitOptions.timeoutMs >= 0
      ? waitOptions.timeoutMs
      : 3000;
    const pending = [...activeOperations];
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const completion = Promise.allSettled(pending).then(() => "drained");
    const outcome = pending.length === 0 ? "drained" : await Promise.race([completion, timeout]);
    clearTimeout(timer);
    if (outcome === "drained") {
      inFlight.clear();
      controllers.clear();
    }
    return Object.freeze({
      drained: outcome === "drained",
      pendingOperations: outcome === "drained" ? 0 : activeOperations.size,
      reason: waitOptions.reason || "drain",
      timedOut: outcome === "timeout",
    });
  }

  function drain(drainOptions = {}) {
    cancelAllOperations(drainOptions.reason || "drain");
    return waitForOperations(drainOptions);
  }

  function shutdown(shutdownOptions = {}) {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    cancelAllOperations(shutdownOptions.reason || "shutdown");
    shutdownPromise = waitForOperations({ ...shutdownOptions, reason: shutdownOptions.reason || "shutdown" });
    return shutdownPromise;
  }

  return {
    cancelAllOperations,
    cancelUserOperations,
    drain,
    getDiagnostics,
    getDiagnosticsSnapshot,
    markRevoked,
    migrateLegacy,
    read,
    refresh,
    remove,
    resolve,
    saveLogin,
    setActive: (userId, setOptions) => shuttingDown
      ? Promise.reject(Object.assign(new Error("El repositorio de sesiones se esta cerrando."), { code: "SESSION_REPOSITORY_SHUTDOWN" }))
      : track(setActiveAccount(config, userId, setOptions)),
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
  migrationLockPath,
  safeUserHash,
  sessionLockPath,
};
