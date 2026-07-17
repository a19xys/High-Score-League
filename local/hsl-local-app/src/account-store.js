const fsp = require("node:fs/promises");
const path = require("node:path");
const { acquireFileLock } = require("./file-lock");
const { atomicWriteJson } = require("./secure-session-storage");

const mutationChains = new Map();

function getKnownAccountsPath(config = {}) {
  if (!config.userDataDir) {
    throw new Error("config.userDataDir es obligatorio para recordar cuentas.");
  }

  return path.join(config.userDataDir, "accounts", "known-accounts.json");
}

function getKnownAccountsLockPath(config = {}) {
  return path.join(config.userDataDir, "accounts", "locks", "known-accounts.lock");
}

function emptyStore(warnings = []) {
  return {
    accounts: [],
    corrupt: false,
    lastActiveUserId: null,
    revision: 0,
    schemaVersion: 2,
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
    requiresLogin: input.requiresLogin === true,
    sessionRevision: Math.max(0, Number(input.sessionRevision) || 0),
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
    corrupt: false,
    lastActiveUserId: sanitizeString(raw?.lastActiveUserId),
    revision: Math.max(0, Number(raw?.revision) || 0),
    schemaVersion: 2,
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
      corrupt: true,
      filePath,
    };
  }
}

async function writeKnownAccountsUnlocked(config = {}, store, options = {}) {
  const filePath = getKnownAccountsPath(config);
  const updatedAt = options.now || new Date().toISOString();
  const data = {
    accounts: store.accounts || [],
    lastActiveUserId: store.lastActiveUserId || null,
    revision: Number(store.revision) || 1,
    schemaVersion: 2,
    updatedAt,
  };

  await atomicWriteJson(filePath, data);

  return {
    ...data,
    filePath,
    warnings: [],
  };
}

function serializeMutation(filePath, operation) {
  const previous = mutationChains.get(filePath) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mutationChains.set(filePath, current);
  return current.finally(() => {
    if (mutationChains.get(filePath) === current) mutationChains.delete(filePath);
  });
}

async function mutateKnownAccounts(config = {}, mutator, options = {}) {
  const filePath = getKnownAccountsPath(config);
  return serializeMutation(filePath, async () => {
    const lock = await acquireFileLock(getKnownAccountsLockPath(config), {
      purpose: "known-accounts",
      staleAfterMs: options.staleAfterMs,
      timeoutMs: options.lockTimeoutMs,
    });
    try {
      const current = await readKnownAccounts(config);
      if (current.corrupt) {
        throw Object.assign(new Error("known-accounts.json esta corrupto; no se sobrescribe."), { code: "KNOWN_ACCOUNTS_CORRUPT" });
      }
      const proposed = await mutator(current);
      if (!proposed) return current;
      return writeKnownAccountsUnlocked(config, {
        accounts: proposed.accounts || [],
        lastActiveUserId: proposed.lastActiveUserId || null,
        revision: current.revision + 1,
      }, options);
    } finally {
      await lock.release();
    }
  });
}

async function rememberAccount(config = {}, accountInput = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const account = sanitizeAccount(accountInput, now);

  if (!account) {
    return readKnownAccounts(config);
  }

  return mutateKnownAccounts(config, (current) => {
    const existing = current.accounts.find((item) => item.userId === account.userId);
    const accounts = current.accounts.filter((item) => item.userId !== account.userId);
    accounts.unshift({
      ...existing,
      ...account,
      addedAt: existing?.addedAt || account.addedAt,
      lastUsedAt: now,
      requiresLogin: options.requiresLogin ?? existing?.requiresLogin ?? false,
      sessionRevision: options.sessionRevision ?? existing?.sessionRevision ?? 0,
    });
    return { accounts, lastActiveUserId: options.setActive === false ? current.lastActiveUserId : account.userId };
  }, { ...options, now });
}

async function rememberSessionAccount(config = {}, session = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const account = accountFromSession(session, now);

  if (!account) return readKnownAccounts(config);
  return mutateKnownAccounts(config, (current) => {
    const existing = current.accounts.find((item) => item.userId === account.userId);
    if (!existing) return null;
    if (current.lastActiveUserId === account.userId && options.touch !== true) return null;
    return {
      accounts: current.accounts.map((item) => item.userId === account.userId ? {
        ...item,
        email: account.email || item.email,
        lastUsedAt: now,
      } : item),
      lastActiveUserId: account.userId,
    };
  }, { ...options, now });
}

async function clearActiveAccount(config = {}, options = {}) {
  return mutateKnownAccounts(config, (current) => ({ accounts: current.accounts, lastActiveUserId: null }), options);
}

async function setActiveAccount(config = {}, userId, options = {}) {
  const safeUserId = sanitizeString(userId);
  return mutateKnownAccounts(config, (current) => {
    if (!safeUserId || !current.accounts.some((account) => account.userId === safeUserId)) {
      throw Object.assign(new Error("La cuenta activa no existe."), { code: "ACCOUNT_NOT_FOUND" });
    }
    return { accounts: current.accounts, lastActiveUserId: safeUserId };
  }, options);
}

async function markAccountRequiresLogin(config = {}, userId, details = {}, options = {}) {
  const safeUserId = sanitizeString(userId);
  return mutateKnownAccounts(config, (current) => ({
    accounts: current.accounts.map((account) => account.userId === safeUserId ? {
      ...account,
      requiresLogin: true,
      sessionRevision: Math.max(Number(account.sessionRevision) || 0, Number(details.sessionRevision) || 0),
    } : account),
    lastActiveUserId: current.lastActiveUserId,
  }), options);
}

async function removeKnownAccount(config = {}, userId, options = {}) {
  const safeUserId = sanitizeString(userId);

  if (!safeUserId) {
    return { ...(await readKnownAccounts(config)), removed: false };
  }
  let removed = false;
  const next = await mutateKnownAccounts(config, (current) => {
    const accounts = current.accounts.filter((account) => account.userId !== safeUserId);
    removed = accounts.length !== current.accounts.length;
    return {
      accounts,
      lastActiveUserId: current.lastActiveUserId === safeUserId ? null : current.lastActiveUserId,
    };
  }, options);
  return { ...next, removed };
}

function toSafeAccountsState(store = emptyStore(), session = {}, options = {}) {
  const activeUserId = store.lastActiveUserId || null;
  const activeAccount = store.accounts.find((account) => account.userId === activeUserId);
  const activeEmail = activeAccount?.email || (session?.hasSession ? session.email || null : null);
  const savedSessionUserIds = options.savedSessionUserIds || new Set();
  const sessionStatuses = options.sessionStatuses || new Map();
  const accounts = store.accounts.map((account) => {
    const sessionState = sessionStatuses.get(account.userId) || null;
    const requiresLogin = account.requiresLogin === true || (Number(sessionState?.pendingCount) > 0
      && ["corrupt", "revoked", "unavailable"].includes(sessionState?.status));

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
  getKnownAccountsPath,
  getKnownAccountsLockPath,
  markAccountRequiresLogin,
  mutateKnownAccounts,
  readKnownAccounts,
  rememberAccount,
  rememberSessionAccount,
  removeKnownAccount,
  safeInitials,
  setActiveAccount,
  toSafeAccountsState,
};
