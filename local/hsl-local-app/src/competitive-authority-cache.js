const fsp = require("node:fs/promises");
const path = require("node:path");
const { atomicWriteJson } = require("./secure-session-storage");

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_ENTRY_LIMIT = 250;
const identifierPattern = /^[A-Za-z0-9._:-]{1,256}$/;

function safePart(value) {
  const normalized = String(value || "").trim();
  return identifierPattern.test(normalized) ? normalized : null;
}

function authorityContextKey({ deploymentKey, origin }) {
  try {
    const normalizedOrigin = new URL(String(origin || "")).origin;
    const deployment = safePart(deploymentKey);
    return deployment ? `${normalizedOrigin}|${deployment}` : null;
  } catch {
    return null;
  }
}

function safeIso(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function publicWeekStateAt(entry = {}, nowMs = Date.now()) {
  if (!entry || entry.conclusive !== true) return "unknown";
  if (entry.publicState === "unlinked" || ["not-found", "not-linked"].includes(entry.reason)) return "unlinked";
  if (entry.seasonStatus === "completed" || entry.publicState === "closed" || ["closed", "published"].includes(entry.derivedStatus)) {
    return "closed";
  }
  if (entry.seasonStatus && entry.seasonStatus !== "active") return "inactive";
  const opensAt = Date.parse(entry.publicStartAt || "");
  const closesAt = Date.parse(entry.finalDeadlineAt || "");
  if (Number.isFinite(opensAt) && nowMs < opensAt) return "inactive";
  if (Number.isFinite(closesAt) && nowMs >= closesAt) return "closed";
  if (Number.isFinite(opensAt) && nowMs >= opensAt) return "active";
  return ["inactive", "active", "closed"].includes(entry.publicState) ? entry.publicState : "unknown";
}

function nextWeekBoundaryAt(entry = {}, nowMs = Date.now()) {
  const candidates = [entry.publicStartAt, entry.finalDeadlineAt]
    .map((value) => Date.parse(value || ""))
    .filter((value) => Number.isFinite(value) && value > nowMs);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function createJsonAuthorityCache(options = {}) {
  const filePath = options.filePath;
  const entryLimit = Number(options.entryLimit) || DEFAULT_ENTRY_LIMIT;
  let entries = [];
  let loaded = false;
  let corrupt = false;
  let writeChain = Promise.resolve();

  async function initialize() {
    if (loaded) return snapshot();
    loaded = true;
    if (!filePath) return snapshot();
    try {
      const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
      if (parsed?.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) throw new Error("invalid-cache");
      entries = parsed.entries.filter((entry) => entry && typeof entry === "object").slice(-entryLimit);
    } catch (error) {
      if (error?.code !== "ENOENT") corrupt = true;
      entries = [];
    }
    return snapshot();
  }

  function snapshot() {
    return { corrupt, entries: entries.map((entry) => ({ ...entry })), filePath, schemaVersion: CACHE_SCHEMA_VERSION };
  }

  function find(key) {
    const entry = entries.find((item) => item.key === key);
    return entry ? { ...entry } : null;
  }

  async function put(key, value) {
    if (!filePath || !key) return null;
    await initialize();
    entries = [...entries.filter((entry) => entry.key !== key), { ...value, key }].slice(-entryLimit);
    const payload = { schemaVersion: CACHE_SCHEMA_VERSION, entries };
    writeChain = writeChain.then(() => (options.atomicWriteImpl || atomicWriteJson)(filePath, payload));
    await writeChain;
    corrupt = false;
    return find(key);
  }

  return { find, initialize, put, snapshot };
}

function weekCachePath(config = {}) {
  return config.userDataDir ? path.join(config.userDataDir, "competitive-authority", "week-capabilities.json") : null;
}

function membershipCachePath(config = {}) {
  return config.userDataDir ? path.join(config.userDataDir, "competitive-authority", "season-memberships.json") : null;
}

function createWeekCapabilityCache(config = {}, options = {}) {
  const cache = createJsonAuthorityCache({ ...options, filePath: options.filePath || weekCachePath(config) });
  function key(context, weekId) {
    const prefix = authorityContextKey(context || {});
    return prefix && safePart(weekId) ? `${prefix}|week:${weekId}` : null;
  }
  return {
    initialize: cache.initialize,
    path: options.filePath || weekCachePath(config),
    async remember(context, capability) {
      if (!capability || capability.conclusive === false || !capability.weekId) return null;
      return cache.put(key(context, capability.weekId), {
        canPlayCompetition: capability.publicState === "active",
        checkedAt: safeIso(capability.checkedAt) || new Date().toISOString(),
        conclusive: true,
        derivedStatus: safePart(capability.derivedStatus),
        finalDeadlineAt: safeIso(capability.finalDeadlineAt),
        publicFreezeAt: safeIso(capability.publicFreezeAt),
        publicStartAt: safeIso(capability.publicStartAt),
        publicState: capability.publicState,
        rawStatus: safePart(capability.rawStatus),
        reason: safePart(capability.reason),
        seasonId: safePart(capability.seasonId),
        seasonStatus: safePart(capability.seasonStatus),
        weekId: safePart(capability.weekId),
      });
    },
    read(context, weekId, nowMs = Date.now()) {
      const entry = cache.find(key(context, weekId));
      if (!entry) return null;
      const publicState = publicWeekStateAt(entry, nowMs);
      return {
        ...entry,
        canPlayCompetition: publicState === "active",
        confirmedPublicState: entry.publicState,
        lastKnownPublicState: publicState,
        nextBoundaryAt: nextWeekBoundaryAt(entry, nowMs),
        publicState,
        source: "durable-cache",
      };
    },
    resolveDeploymentKey(origin) {
      let normalizedOrigin;
      try { normalizedOrigin = new URL(String(origin || "")).origin; } catch { return null; }
      const marker = `${normalizedOrigin}|`;
      const suffix = "|week:";
      const latest = cache.snapshot().entries
        .filter((entry) => entry.key?.startsWith(marker) && entry.key.includes(suffix))
        .sort((left, right) => Date.parse(right.checkedAt || "") - Date.parse(left.checkedAt || ""))[0];
      if (!latest) return null;
      const end = latest.key.indexOf(suffix, marker.length);
      return end > marker.length ? latest.key.slice(marker.length, end) : null;
    },
    snapshot: cache.snapshot,
  };
}

function createMembershipCache(config = {}, options = {}) {
  const cache = createJsonAuthorityCache({ ...options, filePath: options.filePath || membershipCachePath(config) });
  function key(context, userId, seasonId) {
    const prefix = authorityContextKey(context || {});
    return prefix && safePart(userId) && safePart(seasonId) ? `${prefix}|user:${userId}|season:${seasonId}` : null;
  }
  return {
    initialize: cache.initialize,
    path: options.filePath || membershipCachePath(config),
    async remember(context, result) {
      if (!result || !["member", "not_member"].includes(result.status)) return null;
      return cache.put(key(context, result.userId, result.seasonId), {
        checkedAt: safeIso(result.checkedAt) || new Date().toISOString(),
        seasonId: safePart(result.seasonId),
        status: result.status,
        userId: safePart(result.userId),
      });
    },
    read(context, userId, seasonId) {
      const entry = cache.find(key(context, userId, seasonId));
      return entry && ["member", "not_member"].includes(entry.status)
        ? { ...entry, source: "durable-cache" }
        : null;
    },
    snapshot: cache.snapshot,
  };
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  authorityContextKey,
  createMembershipCache,
  createWeekCapabilityCache,
  membershipCachePath,
  nextWeekBoundaryAt,
  publicWeekStateAt,
  weekCachePath,
};
