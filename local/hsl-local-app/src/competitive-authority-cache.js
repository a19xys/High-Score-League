const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  SUPPORTED_LAUNCHER_API_VERSION,
  launcherAuthorityKey,
} = require("./deployment-fingerprint");
const { atomicWriteJson } = require("./secure-session-storage");
const { isRemotePackId } = require("./pack-deeplink");

const CACHE_SCHEMA_VERSION = 3;
const PREVIOUS_CACHE_SCHEMA_VERSION = 2;
const LEGACY_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_ENTRY_LIMIT = 250;
const identifierPattern = /^[A-Za-z0-9._:-]{1,256}$/;
const legacyDeploymentPattern = /^([A-Za-z0-9._-]{1,80}):([A-Za-z0-9._-]{1,80}):(\d+)$/;
const publicWeekStates = new Set(["active", "closed", "inactive", "unlinked"]);

function safePart(value) {
  const normalized = String(value || "").trim();
  return identifierPattern.test(normalized) ? normalized : null;
}

function safeOrigin(value) {
  try {
    const candidate = new URL(String(value || ""));
    if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) return null;
    return candidate.origin;
  } catch {
    return null;
  }
}

function authorityContextKey({ authorityKey, origin } = {}) {
  const normalizedOrigin = safeOrigin(origin);
  const authority = safePart(authorityKey);
  return normalizedOrigin && authority === launcherAuthorityKey()
    ? `${normalizedOrigin}|${authority}`
    : null;
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

function parseStablePrefix(value) {
  const marker = `|${launcherAuthorityKey()}`;
  const markerAt = String(value || "").lastIndexOf(marker);
  if (markerAt <= 0 || markerAt + marker.length !== String(value).length) return null;
  const origin = String(value).slice(0, markerAt);
  return safeOrigin(origin) === origin ? { authorityKey: launcherAuthorityKey(), origin } : null;
}

function parseLegacyPrefix(value) {
  const boundary = String(value || "").lastIndexOf("|");
  if (boundary <= 0) return null;
  const origin = String(value).slice(0, boundary);
  const deployment = legacyDeploymentPattern.exec(String(value).slice(boundary + 1));
  if (!deployment || safeOrigin(origin) !== origin) return null;
  const apiVersion = Number(deployment[3]);
  if (apiVersion !== SUPPORTED_LAUNCHER_API_VERSION) return null;
  return {
    apiVersion,
    authorityKey: launcherAuthorityKey(),
    build: deployment[1],
    environment: deployment[2],
    origin,
  };
}

function parseWeekKey(key, legacy = false) {
  const marker = "|week:";
  const markerAt = String(key || "").lastIndexOf(marker);
  if (markerAt <= 0) return null;
  const weekId = safePart(String(key).slice(markerAt + marker.length));
  const context = legacy
    ? parseLegacyPrefix(String(key).slice(0, markerAt))
    : parseStablePrefix(String(key).slice(0, markerAt));
  return context && weekId ? { ...context, weekId } : null;
}

function parseMembershipKey(key, legacy = false) {
  const userMarker = "|user:";
  const seasonMarker = "|season:";
  const userAt = String(key || "").lastIndexOf(userMarker);
  const seasonAt = String(key || "").lastIndexOf(seasonMarker);
  if (userAt <= 0 || seasonAt <= userAt + userMarker.length) return null;
  const userId = safePart(String(key).slice(userAt + userMarker.length, seasonAt));
  const seasonId = safePart(String(key).slice(seasonAt + seasonMarker.length));
  const context = legacy
    ? parseLegacyPrefix(String(key).slice(0, userAt))
    : parseStablePrefix(String(key).slice(0, userAt));
  return context && userId && seasonId ? { ...context, seasonId, userId } : null;
}

function normalizeWeekEntry(entry, parsed) {
  const checkedAt = safeIso(entry?.checkedAt);
  const weekId = safePart(entry?.weekId);
  if (!parsed || !checkedAt || entry?.conclusive !== true || weekId !== parsed.weekId || !publicWeekStates.has(entry?.publicState)) return null;
  const publishedPackKnown = Object.hasOwn(entry || {}, "publishedPackId")
    && (entry.publishedPackId === null || isRemotePackId(entry.publishedPackId));
  return {
    canPlayCompetition: entry.publicState === "active",
    checkedAt,
    conclusive: true,
    derivedStatus: safePart(entry.derivedStatus),
    finalDeadlineAt: safeIso(entry.finalDeadlineAt),
    publicFreezeAt: safeIso(entry.publicFreezeAt),
    publicStartAt: safeIso(entry.publicStartAt),
    publicState: entry.publicState,
    ...(publishedPackKnown ? { publishedPackId: entry.publishedPackId } : {}),
    rawStatus: safePart(entry.rawStatus),
    reason: safePart(entry.reason),
    seasonId: safePart(entry.seasonId),
    seasonStatus: safePart(entry.seasonStatus),
    weekId,
  };
}

function normalizeMembershipEntry(entry, parsed) {
  const checkedAt = safeIso(entry?.checkedAt);
  const seasonId = safePart(entry?.seasonId);
  const userId = safePart(entry?.userId);
  if (!parsed || !checkedAt || !["member", "not_member"].includes(entry?.status) ||
      seasonId !== parsed.seasonId || userId !== parsed.userId) return null;
  return { checkedAt, seasonId, status: entry.status, userId };
}

function newestEntries(candidates, entryLimit) {
  const entriesByKey = new Map();
  let collisionCount = 0;
  for (const candidate of candidates) {
    const previous = entriesByKey.get(candidate.key);
    if (!previous) {
      entriesByKey.set(candidate.key, candidate);
      continue;
    }
    collisionCount += 1;
    const previousAt = Date.parse(previous.checkedAt || "");
    const candidateAt = Date.parse(candidate.checkedAt || "");
    const candidateWins = candidateAt > previousAt || (
      candidateAt === previousAt && String(candidate.migrationSourceKey || "") > String(previous.migrationSourceKey || "")
    );
    if (candidateWins) entriesByKey.set(candidate.key, candidate);
  }
  const entries = [...entriesByKey.values()]
    .sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt) || left.key.localeCompare(right.key))
    .slice(-entryLimit)
    .map(({ migrationSourceKey: _migrationSourceKey, ...entry }) => entry);
  return { collisionCount, entries };
}

function createJsonAuthorityCache(options = {}) {
  const filePath = options.filePath;
  const entryLimit = Number(options.entryLimit) || DEFAULT_ENTRY_LIMIT;
  let entries = [];
  let loaded = false;
  let corrupt = false;
  let invalidEntryCount = 0;
  let migration = { from: null, to: CACHE_SCHEMA_VERSION, status: "not-needed", migratedEntries: 0, collisionCount: 0 };
  let writeChain = Promise.resolve();

  function snapshot() {
    return {
      corrupt,
      entries: entries.map((entry) => ({ ...entry })),
      filePath,
      invalidEntryCount,
      migration: { ...migration },
      schemaVersion: CACHE_SCHEMA_VERSION,
    };
  }

  function diagnostics() {
    return {
      corrupt,
      entryCount: entries.length,
      invalidEntryCount,
      migration: { ...migration },
      schemaVersion: CACHE_SCHEMA_VERSION,
    };
  }

  async function initialize() {
    if (loaded) return snapshot();
    loaded = true;
    if (!filePath) return snapshot();
    try {
      const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
      if (!Array.isArray(parsed?.entries)) throw new Error("invalid-cache");
      if (parsed.schemaVersion === CACHE_SCHEMA_VERSION) {
        const normalized = parsed.entries.map(options.normalizeCurrentEntry).filter(Boolean);
        invalidEntryCount = parsed.entries.length - normalized.length;
        const current = newestEntries(normalized, entryLimit);
        entries = current.entries;
        corrupt = invalidEntryCount > 0;
        return snapshot();
      }
      if (![LEGACY_CACHE_SCHEMA_VERSION, PREVIOUS_CACHE_SCHEMA_VERSION].includes(parsed.schemaVersion)) {
        throw new Error("unsupported-cache-schema");
      }
      const migrateEntry = parsed.schemaVersion === LEGACY_CACHE_SCHEMA_VERSION
        ? options.migrateLegacyEntry
        : options.normalizeCurrentEntry;
      const normalized = parsed.entries.map(migrateEntry).filter(Boolean);
      invalidEntryCount = parsed.entries.length - normalized.length;
      const migrated = newestEntries(normalized, entryLimit);
      entries = migrated.entries;
      migration = {
        collisionCount: migrated.collisionCount,
        from: parsed.schemaVersion,
        migratedEntries: entries.length,
        status: "validated",
        to: CACHE_SCHEMA_VERSION,
      };
      try {
        await (options.atomicWriteImpl || atomicWriteJson)(filePath, { schemaVersion: CACHE_SCHEMA_VERSION, entries });
        migration.status = "persisted";
      } catch {
        migration.status = "write-failed";
      }
    } catch (error) {
      if (error?.code !== "ENOENT") corrupt = true;
      entries = [];
    }
    return snapshot();
  }

  function find(key) {
    const entry = entries.find((item) => item.key === key);
    return entry ? { ...entry } : null;
  }

  async function put(key, value) {
    if (!filePath || !key) return null;
    await initialize();
    let persisted = null;
    const write = async () => {
      const nextEntries = [...entries.filter((entry) => entry.key !== key), { ...value, key }].slice(-entryLimit);
      await (options.atomicWriteImpl || atomicWriteJson)(filePath, { schemaVersion: CACHE_SCHEMA_VERSION, entries: nextEntries });
      entries = nextEntries;
      corrupt = false;
      invalidEntryCount = 0;
      persisted = find(key);
    };
    writeChain = writeChain.then(write, write);
    await writeChain;
    return persisted;
  }

  return { diagnostics, find, initialize, put, snapshot };
}

function weekCachePath(config = {}) {
  return config.userDataDir ? path.join(config.userDataDir, "competitive-authority", "week-capabilities.json") : null;
}

function membershipCachePath(config = {}) {
  return config.userDataDir ? path.join(config.userDataDir, "competitive-authority", "season-memberships.json") : null;
}

function stableWeekKey(context, weekId) {
  const prefix = authorityContextKey(context || {});
  return prefix && safePart(weekId) ? `${prefix}|week:${weekId}` : null;
}

function stableMembershipKey(context, userId, seasonId) {
  const prefix = authorityContextKey(context || {});
  return prefix && safePart(userId) && safePart(seasonId) ? `${prefix}|user:${userId}|season:${seasonId}` : null;
}

function createWeekCapabilityCache(config = {}, options = {}) {
  const filePath = options.filePath || weekCachePath(config);
  const cache = createJsonAuthorityCache({
    ...options,
    filePath,
    migrateLegacyEntry(entry) {
      const parsed = parseWeekKey(entry?.key, true);
      const normalized = normalizeWeekEntry(entry, parsed);
      const key = parsed ? stableWeekKey(parsed, parsed.weekId) : null;
      return normalized && key ? { ...normalized, key, migrationSourceKey: entry.key } : null;
    },
    normalizeCurrentEntry(entry) {
      const parsed = parseWeekKey(entry?.key, false);
      const normalized = normalizeWeekEntry(entry, parsed);
      return normalized && parsed ? { ...normalized, key: entry.key } : null;
    },
  });
  return {
    initialize: cache.initialize,
    path: filePath,
    async remember(context, capability) {
      if (!capability || capability.conclusive === false || !capability.weekId) return null;
      const weekId = safePart(capability.weekId);
      const value = normalizeWeekEntry({
        ...capability,
        checkedAt: safeIso(capability.checkedAt) || new Date().toISOString(),
        conclusive: true,
        weekId,
      }, { weekId });
      return value ? cache.put(stableWeekKey(context, weekId), value) : null;
    },
    read(context, weekId, nowMs = Date.now()) {
      const entry = cache.find(stableWeekKey(context, weekId));
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
    diagnostics: cache.diagnostics,
    snapshot: cache.snapshot,
  };
}

function createMembershipCache(config = {}, options = {}) {
  const filePath = options.filePath || membershipCachePath(config);
  const cache = createJsonAuthorityCache({
    ...options,
    filePath,
    migrateLegacyEntry(entry) {
      const parsed = parseMembershipKey(entry?.key, true);
      const normalized = normalizeMembershipEntry(entry, parsed);
      const key = parsed ? stableMembershipKey(parsed, parsed.userId, parsed.seasonId) : null;
      return normalized && key ? { ...normalized, key, migrationSourceKey: entry.key } : null;
    },
    normalizeCurrentEntry(entry) {
      const parsed = parseMembershipKey(entry?.key, false);
      const normalized = normalizeMembershipEntry(entry, parsed);
      return normalized && parsed ? { ...normalized, key: entry.key } : null;
    },
  });
  return {
    initialize: cache.initialize,
    path: filePath,
    async remember(context, result) {
      if (!result || !["member", "not_member"].includes(result.status)) return null;
      const parsed = { seasonId: safePart(result.seasonId), userId: safePart(result.userId) };
      const value = normalizeMembershipEntry({
        ...result,
        checkedAt: safeIso(result.checkedAt) || new Date().toISOString(),
      }, parsed);
      return value ? cache.put(stableMembershipKey(context, parsed.userId, parsed.seasonId), value) : null;
    },
    read(context, userId, seasonId) {
      const entry = cache.find(stableMembershipKey(context, userId, seasonId));
      return entry && ["member", "not_member"].includes(entry.status)
        ? { ...entry, source: "durable-cache" }
        : null;
    },
    diagnostics: cache.diagnostics,
    snapshot: cache.snapshot,
  };
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  LEGACY_CACHE_SCHEMA_VERSION,
  PREVIOUS_CACHE_SCHEMA_VERSION,
  authorityContextKey,
  createMembershipCache,
  createWeekCapabilityCache,
  membershipCachePath,
  nextWeekBoundaryAt,
  publicWeekStateAt,
  weekCachePath,
};
