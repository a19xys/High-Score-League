const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

function hashPart(value, length = 16) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function sanitizeKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function derivePlayerKey(session) {
  if (!session?.hasSession) {
    return null;
  }

  if (session.userId) {
    return `user_${sanitizeKeyPart(session.userId) || hashPart(session.userId)}`;
  }

  if (session.email) {
    return `email_${hashPart(session.email.toLowerCase())}`;
  }

  return null;
}

function getPackIdentity(config = {}) {
  const pack = config.pack || {};
  const gameId = pack.gameId || config.gameId || "space-invaders";
  const rom = pack.rom || config.rom || "invaders";
  const weekId = pack.weekId || config.defaultWeekId || "unknown-week";

  return {
    gameId,
    packDir: pack.packRoot || config.packRoot || config.mame?.workingDir || null,
    packId: pack.packId || null,
    rom,
    webBaseUrl: pack.webBaseUrl || config.webBaseUrl || null,
    weekId,
  };
}

function derivePackKey(config = {}) {
  const identity = getPackIdentity(config);

  if (identity.packId) {
    return `pack_${sanitizeKeyPart(identity.packId) || hashPart(identity.packId)}`;
  }

  if (identity.gameId && identity.rom && identity.weekId) {
    const raw = `${identity.gameId}|${identity.rom}|${identity.weekId}`;
    const readable = sanitizeKeyPart(`${identity.gameId}-${identity.rom}-${identity.weekId}`);
    return `pack_${readable || hashPart(raw)}`;
  }

  return `pack_${hashPart(JSON.stringify(identity))}`;
}

function resolveScopedQueue(config = {}, session = {}) {
  const playerKey = derivePlayerKey(session);

  if (!playerKey) {
    return null;
  }

  const packKey = derivePackKey(config);
  const scopedQueueRoot = path.join(config.userDataDir, "players", playerKey, "packs", packKey);
  const eventsRoot = path.join(scopedQueueRoot, "events");

  return {
    eventsRoot,
    packKey,
    playerKey,
    scopedFailedDir: path.join(eventsRoot, "failed"),
    scopedPendingDir: path.join(eventsRoot, "pending"),
    scopedQueueRoot,
    scopedSentDir: path.join(eventsRoot, "sent"),
  };
}

function buildScopedMeta(config = {}, session = {}, scope, options = {}) {
  const now = options.now || new Date().toISOString();
  const pack = getPackIdentity(config);

  return {
    schemaVersion: 1,
    createdAt: options.createdAt || now,
    updatedAt: now,
    player: {
      email: session.email || null,
      playerKey: scope.playerKey,
      userId: session.userId || null,
    },
    pack: {
      gameId: pack.gameId,
      packDir: pack.packDir,
      packId: pack.packId,
      packKey: scope.packKey,
      rom: pack.rom,
      webBaseUrl: pack.webBaseUrl,
      weekId: pack.weekId,
    },
  };
}

async function readExistingMeta(metaPath) {
  try {
    const raw = await fsp.readFile(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function ensureScopedQueue(config = {}, session = {}, options = {}) {
  const scope = resolveScopedQueue(config, session);

  if (!scope) {
    return null;
  }

  await Promise.all([
    fsp.mkdir(scope.scopedPendingDir, { recursive: true }),
    fsp.mkdir(scope.scopedFailedDir, { recursive: true }),
    fsp.mkdir(scope.scopedSentDir, { recursive: true }),
  ]);

  const metaPath = path.join(scope.scopedQueueRoot, "meta.json");
  const existing = await readExistingMeta(metaPath);
  const meta = buildScopedMeta(config, session, scope, {
    createdAt: existing?.createdAt,
    now: options.now,
  });

  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

  return {
    ...scope,
    meta,
    metaPath,
  };
}

function applyScopedQueue(config, scope) {
  if (!scope) {
    return config;
  }

  const isPluginStaging =
    config.eventQueueRole === "plugin-staging" ||
    (Boolean(config.pack || config.mame?.workingDir) &&
      !config.requiresSharedMameRuntime &&
      config.pack?.packVersion !== 2 &&
      config.pack?.contract?.version !== 2);

  return {
    ...config,
    eventsBaseDirAbs: scope.eventsRoot,
    eventsFailedDirAbs: scope.scopedFailedDir,
    eventsPendingDirAbs: scope.scopedPendingDir,
    eventsSentDirAbs: scope.scopedSentDir,
    eventsSource: "scoped-user-pack",
    scopedQueue: scope,
    legacyEventsBaseDirAbs: config.legacyEventsBaseDirAbs || (isPluginStaging ? null : config.eventsBaseDirAbs),
    legacyEventsFailedDirAbs: config.legacyEventsFailedDirAbs || (isPluginStaging ? null : config.eventsFailedDirAbs),
    legacyEventsPendingDirAbs: config.legacyEventsPendingDirAbs || (isPluginStaging ? null : config.eventsPendingDirAbs),
    legacyEventsSentDirAbs: config.legacyEventsSentDirAbs || (isPluginStaging ? null : config.eventsSentDirAbs),
    stagingEventsFailedDirAbs: isPluginStaging ? config.eventsFailedDirAbs : null,
    stagingEventsPendingDirAbs: isPluginStaging ? config.eventsPendingDirAbs : null,
    stagingEventsSentDirAbs: isPluginStaging ? config.eventsSentDirAbs : null,
  };
}

module.exports = {
  applyScopedQueue,
  buildScopedMeta,
  derivePackKey,
  derivePlayerKey,
  ensureScopedQueue,
  getPackIdentity,
  hashPart,
  resolveScopedQueue,
  sanitizeKeyPart,
};
