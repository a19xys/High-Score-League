const fsp = require("node:fs/promises");
const path = require("node:path");
const { derivePlayerKey } = require("./scoped-queue");
const { readStoredSession, writeStoredSession } = require("./secure-session-storage");

function getKnownAccountsPath(config = {}) {
  if (!config.userDataDir) {
    throw new Error("config.userDataDir es obligatorio para recordar cuentas.");
  }

  return path.join(config.userDataDir, "accounts", "known-accounts.json");
}

function getAccountSessionsDir(config = {}) {
  if (!config.userDataDir) {
    throw new Error("config.userDataDir es obligatorio para recordar sesiones.");
  }

  return path.join(config.userDataDir, "accounts", "sessions");
}

function getRememberedSessionPath(config = {}, accountOrSession = {}) {
  const playerKey = derivePlayerKey({
    email: accountOrSession.email || accountOrSession.user?.email,
    hasSession: true,
    userId: accountOrSession.userId || accountOrSession.id || accountOrSession.user?.id,
  });

  if (!playerKey) {
    throw new Error("No se pudo derivar playerKey para la sesion recordada.");
  }

  return path.join(getAccountSessionsDir(config), `${playerKey}.json`);
}

function emptyStore(warnings = []) {
  return {
    accounts: [],
    lastActiveUserId: null,
    schemaVersion: 1,
    updatedAt: null,
    warnings,
  };
}

function sanitizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeInitials(value) {
  const source = sanitizeString(value) || "Jugador";
  const parts = source
    .split(/[@.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .replace(/[^A-Z0-9]/g, "");

  return initials || "JL";
}

function sanitizeAccount(input = {}, now = new Date().toISOString()) {
  const userId = sanitizeString(input.userId || input.id);

  if (!userId) {
    return null;
  }

  const email = sanitizeString(input.email);
  const displayName = sanitizeString(input.displayName || input.name);
  const initials = sanitizeString(input.initials)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ||
    safeInitials(displayName || email || userId);

  return {
    addedAt: sanitizeString(input.addedAt) || now,
    avatarUrl: sanitizeString(input.avatarUrl),
    displayName,
    email,
    initials,
    lastUsedAt: sanitizeString(input.lastUsedAt) || now,
    userId,
  };
}

function accountFromSession(session = {}, now = new Date().toISOString()) {
  if (!session?.hasSession || !session.userId) {
    return null;
  }

  return sanitizeAccount({
    email: session.email,
    lastUsedAt: now,
    userId: session.userId,
  }, now);
}

function normalizeStore(raw, warnings = []) {
  const now = new Date().toISOString();
  const accounts = Array.isArray(raw?.accounts)
    ? raw.accounts.map((account) => sanitizeAccount(account, now)).filter(Boolean)
    : [];
  const seen = new Set();
  const uniqueAccounts = [];

  for (const account of accounts) {
    if (seen.has(account.userId)) {
      continue;
    }

    seen.add(account.userId);
    uniqueAccounts.push(account);
  }

  return {
    accounts: uniqueAccounts,
    lastActiveUserId: sanitizeString(raw?.lastActiveUserId),
    schemaVersion: 1,
    updatedAt: sanitizeString(raw?.updatedAt),
    warnings,
  };
}

async function readKnownAccounts(config = {}) {
  const filePath = getKnownAccountsPath(config);

  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return {
      ...normalizeStore(JSON.parse(raw)),
      filePath,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        ...emptyStore(),
        filePath,
      };
    }

    return {
      ...emptyStore([`No se pudo leer known-accounts.json: ${error.message}`]),
      filePath,
    };
  }
}

async function writeKnownAccounts(config = {}, store, options = {}) {
  const filePath = getKnownAccountsPath(config);
  const updatedAt = options.now || new Date().toISOString();
  const data = {
    accounts: store.accounts || [],
    lastActiveUserId: store.lastActiveUserId || null,
    schemaVersion: 1,
    updatedAt,
  };

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");

  return {
    ...data,
    filePath,
    warnings: [],
  };
}

async function rememberAccount(config = {}, accountInput = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const account = sanitizeAccount(accountInput, now);

  if (!account) {
    return readKnownAccounts(config);
  }

  const current = await readKnownAccounts(config);
  const existing = current.accounts.find((item) => item.userId === account.userId);
  const accounts = current.accounts.filter((item) => item.userId !== account.userId);

  accounts.unshift({
    ...existing,
    ...account,
    addedAt: existing?.addedAt || account.addedAt,
    lastUsedAt: now,
  });

  return writeKnownAccounts(config, {
    accounts,
    lastActiveUserId: account.userId,
  }, { now });
}

async function rememberSessionAccount(config = {}, session = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const account = accountFromSession(session, now);

  if (!account) {
    return readKnownAccounts(config);
  }

  const current = await readKnownAccounts(config);
  const exists = current.accounts.some((item) => item.userId === account.userId);
  const activeMatches = current.lastActiveUserId === account.userId;

  if (exists && activeMatches && options.touch !== true) {
    return current;
  }

  return rememberAccount(config, account, { now });
}

async function saveRememberedSession(config = {}, storedSession = {}) {
  const filePath = getRememberedSessionPath(config, storedSession);
  const playerKey = derivePlayerKey({
    email: storedSession.user?.email,
    hasSession: true,
    userId: storedSession.user?.id,
  });
  const written = await writeStoredSession(filePath, storedSession, {
    expectedUserId: storedSession.user?.id,
    playerKey,
  });

  return {
    filePath,
    ok: true,
    revision: written.envelope.revision,
    storage: written.storage,
  };
}

async function readRememberedSession(config = {}, account = {}) {
  const filePath = getRememberedSessionPath(config, account);

  try {
    const stored = await readStoredSession(filePath);
    return {
      filePath,
      ok: Boolean(stored.storedSession),
      revision: stored.revision,
      session: stored.storedSession,
      status: stored.status,
      storage: stored.storage,
    };
  } catch (error) {
    return {
      error: error.code === "ENOENT" ? null : error.message,
      filePath,
      ok: false,
      session: null,
      status: error.code === "ENOENT" ? "missing" : "invalid",
    };
  }
}

async function deleteRememberedSession(config = {}, account = {}) {
  const filePath = getRememberedSessionPath(config, account);

  try {
    await fsp.unlink(filePath);
    return {
      deleted: true,
      filePath,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        deleted: false,
        filePath,
      };
    }

    throw error;
  }
}

async function listSavedSessionUserIds(config = {}, accounts = []) {
  const saved = new Set();

  for (const account of accounts) {
    try {
      const result = await readRememberedSession(config, account);

      if (result.ok) {
        saved.add(account.userId);
      }
    } catch {
      // Ignore malformed account rows for renderer state.
    }
  }

  return saved;
}

async function migrateRememberedSessions(config = {}, accounts = []) {
  const results = [];

  for (const account of accounts) {
    const result = await readRememberedSession(config, account);
    results.push({
      migrated: result.ok && result.status === "valid",
      status: result.status,
      userId: account.userId,
    });
  }

  return results;
}

async function clearActiveAccount(config = {}, options = {}) {
  const current = await readKnownAccounts(config);
  return writeKnownAccounts(config, {
    accounts: current.accounts,
    lastActiveUserId: null,
  }, options);
}

async function removeKnownAccount(config = {}, userId, options = {}) {
  const current = await readKnownAccounts(config);
  const safeUserId = sanitizeString(userId);

  if (!safeUserId) {
    return {
      ...current,
      removed: false,
    };
  }

  const accounts = current.accounts.filter((account) => account.userId !== safeUserId);
  const removed = accounts.length !== current.accounts.length;
  const lastActiveUserId = current.lastActiveUserId === safeUserId ? null : current.lastActiveUserId;
  await deleteRememberedSession(config, { userId: safeUserId }).catch(() => null);

  const next = await writeKnownAccounts(config, {
    accounts,
    lastActiveUserId,
  }, options);

  return {
    ...next,
    removed,
  };
}

function toSafeAccountsState(store = emptyStore(), session = {}, options = {}) {
  const activeUserId = session?.hasSession ? session.userId || null : null;
  const activeEmail = session?.hasSession ? session.email || null : null;
  const savedSessionUserIds = options.savedSessionUserIds || new Set();
  const sessionStatuses = options.sessionStatuses || new Map();
  const accounts = store.accounts.map((account) => {
    const sessionState = sessionStatuses.get(account.userId) || null;
    const requiresLogin = Number(sessionState?.pendingCount) > 0
      && ["corrupt", "revoked", "unavailable"].includes(sessionState?.status);

    return {
      avatarUrl: account.avatarUrl,
      displayName: account.displayName,
      email: account.email,
      hasSavedSession: savedSessionUserIds.has(account.userId),
      initials: account.initials,
      isActive: Boolean(activeUserId && account.userId === activeUserId),
      lastUsedAt: account.lastUsedAt,
      requiresLogin,
      requiresLoginMessage: requiresLogin
        ? "Esta cuenta tiene puntuaciones pendientes. Inicia sesion para enviarlas."
        : null,
      sessionStatus: sessionState?.status || null,
      userId: account.userId,
    };
  });

  return {
    activeEmail,
    activeUserId,
    filePath: store.filePath || null,
    hasKnownAccounts: accounts.length > 0,
    knownAccounts: accounts,
    warnings: store.warnings || [],
  };
}

module.exports = {
  accountFromSession,
  clearActiveAccount,
  deleteRememberedSession,
  getAccountSessionsDir,
  getKnownAccountsPath,
  getRememberedSessionPath,
  listSavedSessionUserIds,
  migrateRememberedSessions,
  readKnownAccounts,
  readRememberedSession,
  rememberAccount,
  rememberSessionAccount,
  removeKnownAccount,
  safeInitials,
  saveRememberedSession,
  toSafeAccountsState,
};
