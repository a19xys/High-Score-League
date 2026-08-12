const { readKnownAccounts } = require("./account-store");
const { hashPart, sanitizeKeyPart } = require("./scoped-queue");

const GLOBAL_PREFERENCE_SCOPE = Object.freeze({
  playerKey: null,
  scope: "global",
  scopeKey: "global",
});

function playerKeyFromLocalUserId(userId) {
  const value = typeof userId === "string" ? userId.trim() : "";
  if (!value) return null;
  return `user_${sanitizeKeyPart(value) || hashPart(value)}`;
}

function playerPreferenceScope(userId) {
  const playerKey = playerKeyFromLocalUserId(userId);
  if (!playerKey) return { ...GLOBAL_PREFERENCE_SCOPE };
  return {
    playerKey,
    scope: "player",
    scopeKey: `player:${playerKey}`,
  };
}

function normalizePreferenceScope(value = {}) {
  if (value?.scope === "player" && typeof value.playerKey === "string" && value.playerKey.trim()) {
    const playerKey = value.playerKey.trim();
    return {
      playerKey,
      scope: "player",
      scopeKey: `player:${playerKey}`,
    };
  }
  if (typeof value?.scopeKey === "string" && value.scopeKey.startsWith("player:")) {
    const playerKey = value.scopeKey.slice("player:".length).trim();
    if (playerKey) return { playerKey, scope: "player", scopeKey: `player:${playerKey}` };
  }
  return { ...GLOBAL_PREFERENCE_SCOPE };
}

function preferenceScopeFromAccounts(accounts = {}) {
  const activeUserId = typeof accounts.lastActiveUserId === "string"
    ? accounts.lastActiveUserId.trim()
    : "";
  if (!activeUserId) return { ...GLOBAL_PREFERENCE_SCOPE };
  if (!Array.isArray(accounts.accounts) || !accounts.accounts.some((account) => account?.userId === activeUserId)) {
    return { ...GLOBAL_PREFERENCE_SCOPE };
  }
  return playerPreferenceScope(activeUserId);
}

function preferenceScopeFromSession(session = {}) {
  return session?.hasSession && session.userId
    ? playerPreferenceScope(session.userId)
    : { ...GLOBAL_PREFERENCE_SCOPE };
}

async function resolvePlayerPreferenceScope(config = {}, options = {}) {
  const accounts = options.accounts || await (options.readKnownAccountsImpl || readKnownAccounts)(config);
  return preferenceScopeFromAccounts(accounts);
}

function preferenceScopesEqual(left, right) {
  return normalizePreferenceScope(left).scopeKey === normalizePreferenceScope(right).scopeKey;
}

module.exports = {
  GLOBAL_PREFERENCE_SCOPE,
  normalizePreferenceScope,
  playerKeyFromLocalUserId,
  playerPreferenceScope,
  preferenceScopeFromAccounts,
  preferenceScopeFromSession,
  preferenceScopesEqual,
  resolvePlayerPreferenceScope,
};
