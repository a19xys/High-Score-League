const REMOTE_PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const PACK_DEEP_LINK_SCHEME = "highscoreleague:";

function isRemotePackId(value) {
  return typeof value === "string" && REMOTE_PACK_ID_PATTERN.test(value);
}

function normalizedPackImportIntent(packId) {
  if (!isRemotePackId(packId)) return null;
  return Object.freeze({
    version: 1,
    type: "import-pack",
    packId,
  });
}

function parsePackDeepLink(value) {
  if (typeof value !== "string" || !value.startsWith(PACK_DEEP_LINK_SCHEME)) {
    return null;
  }
  const canonical = /^highscoreleague:\/\/import-pack\/([a-z0-9][a-z0-9_-]{0,127})$/.exec(value);
  if (!canonical) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== PACK_DEEP_LINK_SCHEME
    || parsed.hostname !== "import-pack"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    return null;
  }

  const rawPath = parsed.pathname;
  if (rawPath !== `/${canonical[1]}`) {
    return null;
  }

  return normalizedPackImportIntent(canonical[1]);
}

function parsePackDeepLinkArgv(argv = []) {
  const candidates = Array.isArray(argv)
    ? argv.filter((value) => typeof value === "string" && value.toLowerCase().startsWith(PACK_DEEP_LINK_SCHEME))
    : [];

  if (candidates.length === 0) return Object.freeze({ intent: null, status: "none" });
  if (candidates.length !== 1) return Object.freeze({ intent: null, status: "ambiguous" });

  const intent = parsePackDeepLink(candidates[0]);
  return Object.freeze({ intent, status: intent ? "valid" : "invalid" });
}

function parsePackDeepLinkAdditionalData(additionalData) {
  const value = additionalData?.packDeepLink;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys.join(",") !== "packId,type,version") return null;
  if (value.version !== 1 || value.type !== "import-pack") return null;
  return normalizedPackImportIntent(value.packId);
}

function createPackDeepLinkAdditionalData(intent) {
  const normalized = parsePackDeepLinkAdditionalData({ packDeepLink: intent });
  return normalized ? { packDeepLink: { ...normalized } } : {};
}

module.exports = {
  PACK_DEEP_LINK_SCHEME,
  REMOTE_PACK_ID_PATTERN,
  createPackDeepLinkAdditionalData,
  isRemotePackId,
  normalizedPackImportIntent,
  parsePackDeepLink,
  parsePackDeepLinkAdditionalData,
  parsePackDeepLinkArgv,
};
