const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { readEventFile } = require("./event-files");
const { reconcileLegacyGeneric409Failures } = require("./file-queue");
const { deriveCompetitionPlayerBinding } = require("./competition-player-binding");
const {
  INVALID_PROTECTED_COMPETITION_MODE,
  PROTECTED_COMPETITION_MODE,
  ensureScopeCompetitionAuthority,
  resolveScopeCompetitionAuthority,
} = require("./competition-scope-authority");

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
    scopedRejectedDir: path.join(eventsRoot, "rejected"),
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
    const stat = await fsp.lstat(metaPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return { status: "unsafe", value: null };
    if (stat.size <= 0 || stat.size > 64 * 1024) return { status: "corrupt", value: null };
    const raw = await fsp.readFile(metaPath, "utf8");
    return { status: "parsed", value: JSON.parse(raw) };
  } catch (error) {
    return error?.code === "ENOENT"
      ? { status: "missing", value: null }
      : { status: "corrupt", value: null };
  }
}

async function atomicWriteScopedMeta(metaPath, meta, options = {}) {
  await fsp.mkdir(path.dirname(metaPath), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(meta, null, 2), "utf8");
  const current = await fsp.readFile(metaPath).catch((error) => (error?.code === "ENOENT" ? null : Promise.reject(error)));
  if (current?.equals(bytes)) return { alreadyCurrent: true, metaPath };
  const temporaryPath = path.join(
    path.dirname(metaPath),
    `.${path.basename(metaPath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`,
  );
  let handle;
  try {
    handle = await fsp.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await options.beforeMetaRename?.(temporaryPath, metaPath);
    await (options.renameMetaImpl || fsp.rename)(temporaryPath, metaPath);
    const directory = await fsp.open(path.dirname(metaPath), "r").catch(() => null);
    await directory?.sync().catch(() => null);
    await directory?.close().catch(() => null);
    return { alreadyCurrent: false, metaPath };
  } catch (error) {
    await handle?.close().catch(() => null);
    await fsp.rm(temporaryPath, { force: true }).catch(() => null);
    throw error;
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
    fsp.mkdir(scope.scopedRejectedDir, { recursive: true }),
    fsp.mkdir(scope.scopedSentDir, { recursive: true }),
  ]);

  const metaPath = path.join(scope.scopedQueueRoot, "meta.json");
  const existing = await readExistingMeta(metaPath);
  if (existing.status === "unsafe") throw new Error("La metadata scoped existente no es un fichero regular seguro.");
  if (existing.status === "parsed") {
    const validation = validateScopedMeta(existing.value, {
      packKey: scope.packKey,
      playerKey: scope.playerKey,
      userId: session.userId,
    });
    if (!validation.ok) throw new Error(`La metadata scoped existente contradice el scope: ${validation.reason}.`);
  }
  const meta = buildScopedMeta(config, session, scope, {
    createdAt: existing.value?.createdAt,
    now: options.now,
  });
  const competitionAuthority = await ensureScopeCompetitionAuthority(config, scope, meta, options);
  await (options.atomicWriteMetaImpl || atomicWriteScopedMeta)(metaPath, meta, options);

  await reconcileLegacyGeneric409Failures({
    eventsFailedDirAbs: scope.scopedFailedDir,
    eventsPendingDirAbs: scope.scopedPendingDir,
  });

  return {
    ...scope,
    competitionMode: competitionAuthority.competitionMode,
    meta,
    metaPath,
    scopeAuthority: competitionAuthority.authority,
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
    eventsRejectedDirAbs: scope.scopedRejectedDir,
    eventsSentDirAbs: scope.scopedSentDir,
    eventsSource: "scoped-user-pack",
    // Scoped pending is populated only by whole-file move/rename adoption (or
    // restore), never by a writer holding an open final JSON handle.
    recentEventThresholdMs: 0,
    scopedQueue: scope,
    legacyEventsBaseDirAbs: config.legacyEventsBaseDirAbs || (isPluginStaging ? null : config.eventsBaseDirAbs),
    legacyEventsFailedDirAbs: config.legacyEventsFailedDirAbs || (isPluginStaging ? null : config.eventsFailedDirAbs),
    legacyEventsPendingDirAbs: config.legacyEventsPendingDirAbs || (isPluginStaging ? null : config.eventsPendingDirAbs),
    legacyEventsRejectedDirAbs: config.legacyEventsRejectedDirAbs || (isPluginStaging ? null : config.eventsRejectedDirAbs),
    legacyEventsSentDirAbs: config.legacyEventsSentDirAbs || (isPluginStaging ? null : config.eventsSentDirAbs),
    stagingEventsFailedDirAbs: isPluginStaging ? config.eventsFailedDirAbs : null,
    stagingEventsPendingDirAbs: isPluginStaging ? config.eventsPendingDirAbs : null,
    stagingEventsRejectedDirAbs: isPluginStaging ? config.eventsRejectedDirAbs : null,
    stagingEventsSentDirAbs: isPluginStaging ? config.eventsSentDirAbs : null,
  };
}

function validateScopedMeta(meta, expected = {}) {
  const pack = meta?.pack || {};
  const player = meta?.player || {};
  if (meta?.schemaVersion !== 1) return { ok: false, reason: "unsupported-meta-contract" };
  if (!expected.playerKey || player.playerKey !== expected.playerKey) return { ok: false, reason: "player-mismatch" };
  if (expected.userId && player.userId && player.userId !== expected.userId) return { ok: false, reason: "user-mismatch" };
  if (!expected.packKey || pack.packKey !== expected.packKey) return { ok: false, reason: "pack-mismatch" };
  if (typeof pack.weekId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(pack.weekId)) {
    return { ok: false, reason: "invalid-week" };
  }
  try {
    const url = new URL(String(pack.webBaseUrl || ""));
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false, reason: "invalid-origin" };
  } catch {
    return { ok: false, reason: "invalid-origin" };
  }
  return { ok: true, reason: null };
}

function buildScopedSubmitConfig(baseConfig, scopeRecord, options = {}) {
  const { meta, scope } = scopeRecord;
  const declaredModes = [scopeRecord.competitionMode, scope.competitionMode, scopeRecord.scopeAuthority?.mode, scope.scopeAuthority?.mode];
  if (declaredModes.includes(INVALID_PROTECTED_COMPETITION_MODE)) {
    throw new Error("La autoridad competitiva del scope es invalida y no puede usarse para submit.");
  }
  const competitionMode = declaredModes.includes(PROTECTED_COMPETITION_MODE)
    ? PROTECTED_COMPETITION_MODE
    : "legacy";
  return {
    ...baseConfig,
    competitionMode,
    competitionPlayerBinding: meta.player.userId ? deriveCompetitionPlayerBinding(meta.player.userId) : null,
    defaultWeekId: meta.pack.weekId,
    eventsBaseDirAbs: scope.eventsRoot,
    eventsFailedDirAbs: scope.scopedFailedDir,
    eventsPendingDirAbs: scope.scopedPendingDir,
    eventsRejectedDirAbs: scope.scopedRejectedDir,
    eventsSentDirAbs: scope.scopedSentDir,
    eventsSource: "scoped-user-pack",
    // Discovery has already crossed the same whole-file scoped queue boundary.
    recentEventThresholdMs: 0,
    pack: {
      gameId: meta.pack.gameId || null,
      packId: meta.pack.packId || null,
      packRoot: meta.pack.packDir || null,
      rom: meta.pack.rom || null,
      // Metadata historica/de presentacion. Nunca es autoridad de networking.
      webBaseUrl: meta.pack.webBaseUrl,
      weekId: meta.pack.weekId,
    },
    protectedCompetitionEvidenceRequired: competitionMode === PROTECTED_COMPETITION_MODE,
    scopedQueue: {
      ...scope,
      competitionMode,
      meta,
      scopeAuthority: scopeRecord.scopeAuthority || scope.scopeAuthority || null,
    },
    sessionFileAbs: options.sessionFileAbs || baseConfig.sessionFileAbs,
    // La autoridad remota resuelta por el launcher sobrevive a discovery.
    hslOrigin: baseConfig.hslOrigin,
    remoteConfiguration: baseConfig.remoteConfiguration,
    webBaseUrl: baseConfig.webBaseUrl,
  };
}

async function listPendingDescriptors(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const descriptors = [];
    for (const filename of files) {
      const stat = await fsp.stat(path.join(dir, filename));
      const parsed = await readEventFile(dir, filename).catch(() => ({ ok: false }));
      descriptors.push({ filename, mtimeMs: Math.trunc(stat.mtimeMs), size: stat.size, valid: parsed.ok === true });
    }
    return { descriptors, readable: true };
  } catch (error) {
    return { descriptors: [], readable: error?.code === "ENOENT", reason: error?.code === "ENOENT" ? null : "pending-unreadable" };
  }
}

async function buildPlayerPendingIndex(config = {}, session = {}) {
  const playerKey = derivePlayerKey(session);
  const records = [];
  const scopes = [];
  const skipped = [];
  const revisionParts = [];
  if (!playerKey || !config.userDataDir) {
    return {
      playerKey,
      records,
      revision: hashPart("missing-player", 32),
      scopes,
      skipped: [{ reason: "missing-player" }],
      totals: { invalidPending: 0, pending: 0, validPending: 0 },
      userId: session.userId || null,
    };
  }
  const packsRoot = path.join(config.userDataDir, "players", playerKey, "packs");
  let entries;
  try {
    entries = await fsp.readdir(packsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") skipped.push({ reason: "packs-unreadable" });
    entries = [];
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      skipped.push({ packKey: entry.name, reason: "not-directory" });
      continue;
    }
    const scopedQueueRoot = path.join(packsRoot, entry.name);
    const eventsRoot = path.join(scopedQueueRoot, "events");
    const scope = {
      eventsRoot,
      packKey: entry.name,
      playerKey,
      scopedFailedDir: path.join(eventsRoot, "failed"),
      scopedPendingDir: path.join(eventsRoot, "pending"),
      scopedQueueRoot,
      scopedRejectedDir: path.join(eventsRoot, "rejected"),
      scopedSentDir: path.join(eventsRoot, "sent"),
    };
    let meta;
    try {
      const metaPath = path.join(scopedQueueRoot, "meta.json");
      const raw = await fsp.readFile(metaPath, "utf8");
      if (raw.length > 64 * 1024) throw new Error("meta-too-large");
      meta = JSON.parse(raw);
    } catch {
      skipped.push({ packKey: entry.name, reason: "invalid-meta" });
      revisionParts.push([entry.name, "invalid-meta"]);
      continue;
    }
    const validation = validateScopedMeta(meta, { packKey: entry.name, playerKey, userId: session.userId });
    if (!validation.ok) {
      skipped.push({ packKey: entry.name, reason: validation.reason });
      revisionParts.push([entry.name, validation.reason]);
      continue;
    }
    const competitionAuthority = await resolveScopeCompetitionAuthority(scope, meta);
    if (competitionAuthority.competitionMode === INVALID_PROTECTED_COMPETITION_MODE) {
      const pending = await listPendingDescriptors(scope.scopedPendingDir);
      skipped.push({
        count: pending.descriptors.length,
        packKey: entry.name,
        reason: competitionAuthority.reason || "invalid-scope-authority",
      });
      revisionParts.push([entry.name, "protected-invalid", competitionAuthority.reason, pending.descriptors]);
      continue;
    }
    await reconcileLegacyGeneric409Failures({
      eventsFailedDirAbs: scope.scopedFailedDir,
      eventsPendingDirAbs: scope.scopedPendingDir,
    });
    const pending = await listPendingDescriptors(scope.scopedPendingDir);
    if (!pending.readable) {
      skipped.push({ packKey: entry.name, reason: pending.reason });
      continue;
    }
    const pendingCount = pending.descriptors.length;
    const validPendingCount = pending.descriptors.filter((item) => item.valid).length;
    const record = {
      accepted: true,
      invalidPendingCount: pendingCount - validPendingCount,
      competitionMode: competitionAuthority.competitionMode,
      meta,
      metaStatus: "valid",
      pendingCount,
      scope,
      scopeAuthority: competitionAuthority.authority,
      validPendingCount,
    };
    scopes.push(record);
    if (pendingCount > 0) records.push(record);
    revisionParts.push([
      entry.name,
      meta.schemaVersion,
      meta.player,
      meta.pack,
      competitionAuthority.competitionMode,
      competitionAuthority.authority,
      pending.descriptors.map((item) => [item.filename, item.size, item.mtimeMs, item.valid]),
    ]);
  }
  const totals = scopes.reduce((sum, item) => ({
    invalidPending: sum.invalidPending + item.invalidPendingCount,
    pending: sum.pending + item.pendingCount,
    validPending: sum.validPending + item.validPendingCount,
  }), { invalidPending: 0, pending: 0, validPending: 0 });
  const unscopedDir = config.eventsPendingDirAbs || path.join(config.userDataDir, "events", "pending");
  const unscoped = await listPendingDescriptors(unscopedDir);
  if (unscoped.descriptors.length > 0) {
    skipped.push({ count: unscoped.descriptors.length, reason: "legacy-ambiguous" });
    revisionParts.push(["legacy-ambiguous", unscoped.descriptors.map((item) => [item.filename, item.size, item.mtimeMs])]);
  }
  return {
    playerKey,
    records,
    revision: hashPart(JSON.stringify(revisionParts), 32),
    scopes,
    skipped,
    totals,
    userId: session.userId || null,
  };
}

async function discoverPlayerPendingScopes(config = {}, session = {}) {
  return buildPlayerPendingIndex(config, session);
}

module.exports = {
  applyScopedQueue,
  atomicWriteScopedMeta,
  buildScopedSubmitConfig,
  buildScopedMeta,
  buildPlayerPendingIndex,
  derivePackKey,
  derivePlayerKey,
  discoverPlayerPendingScopes,
  ensureScopedQueue,
  getPackIdentity,
  hashPart,
  resolveScopedQueue,
  sanitizeKeyPart,
  validateScopedMeta,
};
