const fsp = require("node:fs/promises");
const path = require("node:path");
const { atomicWriteJson } = require("./secure-session-storage");

const PLAY_TIME_SCHEMA_VERSION = 1;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mutationChains = new Map();

function emptySummary() {
  return {
    games: {},
    pendingApplied: {},
    schemaVersion: PLAY_TIME_SCHEMA_VERSION,
    totalSeconds: 0,
    updatedAt: null,
  };
}

function safeKey(value, field, maxLength = 128) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw Object.assign(new Error(`${field} invalido.`), { code: "PLAYTIME_INVALID_EVENT" });
  return text;
}

function normalizeEvent(input = {}) {
  const eventId = safeKey(input.eventId, "eventId", 64);
  if (!EVENT_ID_PATTERN.test(eventId)) throw Object.assign(new Error("eventId invalido."), { code: "PLAYTIME_INVALID_EVENT" });
  const mode = input.mode;
  if (!new Set(["practice", "competition"]).has(mode)) throw Object.assign(new Error("mode invalido."), { code: "PLAYTIME_INVALID_EVENT" });
  const durationSeconds = Number(input.durationSeconds);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 604800) {
    throw Object.assign(new Error("durationSeconds invalido."), { code: "PLAYTIME_INVALID_EVENT" });
  }
  const startedAt = safeKey(input.startedAt, "startedAt", 64);
  const endedAt = safeKey(input.endedAt, "endedAt", 64);
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt)) || Date.parse(endedAt) < Date.parse(startedAt)) {
    throw Object.assign(new Error("Rango temporal invalido."), { code: "PLAYTIME_INVALID_EVENT" });
  }

  return {
    clientVersion: input.clientVersion ? safeKey(input.clientVersion, "clientVersion", 64) : null,
    durationSeconds,
    endedAt,
    eventId,
    gameKey: safeKey(input.gameKey, "gameKey"),
    mode,
    rom: input.rom ? safeKey(input.rom, "rom") : null,
    schemaVersion: PLAY_TIME_SCHEMA_VERSION,
    startedAt,
    weekId: safeKey(input.weekId, "weekId", 128),
  };
}

function normalizeSummary(raw = {}) {
  if (raw?.schemaVersion !== PLAY_TIME_SCHEMA_VERSION || !raw.games || !raw.pendingApplied) {
    throw Object.assign(new Error("summary.json no cumple el contrato Playtime."), { code: "PLAYTIME_CORRUPT_SUMMARY" });
  }
  const games = {};
  for (const [gameKey, game] of Object.entries(raw.games)) {
    const totalSeconds = Number(game?.totalSeconds);
    if (!gameKey || !Number.isSafeInteger(totalSeconds) || totalSeconds < 0) {
      throw Object.assign(new Error("summary.json contiene un juego invalido."), { code: "PLAYTIME_CORRUPT_SUMMARY" });
    }
    games[gameKey] = { totalSeconds };
  }
  const totalSeconds = Number(raw.totalSeconds);
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0) {
    throw Object.assign(new Error("summary.json contiene un total invalido."), { code: "PLAYTIME_CORRUPT_SUMMARY" });
  }
  const pendingApplied = {};
  for (const [eventId, marker] of Object.entries(raw.pendingApplied)) {
    if (!EVENT_ID_PATTERN.test(eventId)) {
      throw Object.assign(new Error("summary.json contiene un marker invalido."), { code: "PLAYTIME_CORRUPT_SUMMARY" });
    }
    const durationSeconds = Number(marker?.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 604800) {
      throw Object.assign(new Error("summary.json contiene un marker invalido."), { code: "PLAYTIME_CORRUPT_SUMMARY" });
    }
    pendingApplied[eventId] = {
      durationSeconds,
      gameKey: safeKey(marker.gameKey, "gameKey"),
    };
  }
  const gamesTotal = Object.values(games).reduce((sum, game) => sum + game.totalSeconds, 0);
  if (gamesTotal !== totalSeconds) {
    throw Object.assign(new Error("summary.json contiene totales incoherentes."), { code: "PLAYTIME_CORRUPT_SUMMARY" });
  }
  return {
    games,
    pendingApplied,
    schemaVersion: PLAY_TIME_SCHEMA_VERSION,
    totalSeconds,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

function playTimePaths(config, playerKey) {
  if (!config?.userDataDir || !playerKey) throw new Error("userDataDir y playerKey son obligatorios para Playtime.");
  const root = path.join(config.userDataDir, "players", playerKey, "playtime");
  return {
    active: path.join(root, "active.json"),
    failed: path.join(root, "failed"),
    pending: path.join(root, "pending"),
    root,
    summary: path.join(root, "summary.json"),
  };
}

function enqueue(root, operation) {
  const previous = mutationChains.get(root) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  const tracked = next.catch(() => {}).finally(() => {
    if (mutationChains.get(root) === tracked) mutationChains.delete(root);
  });
  mutationChains.set(root, tracked);
  return next;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function listJson(directory) {
  try {
    return (await fsp.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function createPlayTimeStore(config, playerKey, options = {}) {
  const paths = playTimePaths(config, playerKey);
  const atomicWrite = options.atomicWriteImpl || atomicWriteJson;
  const nowIso = options.nowIso || (() => new Date().toISOString());

  async function ensureDirectories() {
    await Promise.all([
      fsp.mkdir(paths.pending, { recursive: true }),
      fsp.mkdir(paths.failed, { recursive: true }),
    ]);
  }

  async function readSummaryUnsafe() {
    try {
      const raw = await readJson(paths.summary);
      if (!raw) return emptySummary();
      return normalizeSummary(raw);
    } catch (error) {
      const quarantine = `${paths.summary}.corrupt-${Date.now()}`;
      await fsp.rename(paths.summary, quarantine).catch(() => {});
      return { ...emptySummary(), warnings: [error.code || "PLAYTIME_CORRUPT_SUMMARY"] };
    }
  }

  async function pendingEventsUnsafe() {
    await ensureDirectories();
    const events = [];
    for (const filename of await listJson(paths.pending)) {
      const fullPath = path.join(paths.pending, filename);
      try {
        const event = normalizeEvent(await readJson(fullPath));
        if (`${event.eventId}.json` !== filename) throw Object.assign(new Error("Nombre de evento invalido."), { code: "PLAYTIME_INVALID_EVENT" });
        events.push(event);
      } catch (error) {
        const rejectedPath = path.join(paths.failed, `${path.basename(filename, ".json")}-corrupt.json`);
        await fsp.rename(fullPath, rejectedPath).catch(() => {});
      }
    }
    return events;
  }

  async function reconcileUnsafe() {
    const [summary, events] = await Promise.all([readSummaryUnsafe(), pendingEventsUnsafe()]);
    const pendingIds = new Set(events.map((event) => event.eventId));
    let changed = Boolean(summary.warnings);
    delete summary.warnings;
    for (const event of events) {
      if (summary.pendingApplied[event.eventId]) continue;
      summary.totalSeconds += event.durationSeconds;
      const game = summary.games[event.gameKey] || { totalSeconds: 0 };
      summary.games[event.gameKey] = { totalSeconds: game.totalSeconds + event.durationSeconds };
      summary.pendingApplied[event.eventId] = {
        durationSeconds: event.durationSeconds,
        gameKey: event.gameKey,
      };
      changed = true;
    }
    for (const eventId of Object.keys(summary.pendingApplied)) {
      if (pendingIds.has(eventId)) continue;
      delete summary.pendingApplied[eventId];
      changed = true;
    }
    if (changed) {
      summary.updatedAt = nowIso();
      await atomicWrite(paths.summary, summary);
    }
    return { events, summary };
  }

  function mutate(operation) {
    return enqueue(paths.root, async () => {
      await ensureDirectories();
      return operation();
    });
  }

  async function recordEvent(input) {
    const event = normalizeEvent(input);
    return mutate(async () => {
      const pendingPath = path.join(paths.pending, `${event.eventId}.json`);
      const existing = await readJson(pendingPath);
      if (existing) {
        const normalizedExisting = normalizeEvent(existing);
        if (JSON.stringify(normalizedExisting) !== JSON.stringify(event)) {
          throw Object.assign(new Error("eventId ya existe con otro contenido."), { code: "PLAYTIME_EVENT_COLLISION" });
        }
      } else {
        await atomicWrite(pendingPath, event);
      }
      const { summary } = await reconcileUnsafe();
      return { event, pendingPath, summary };
    });
  }

  async function acknowledge(eventId) {
    if (!EVENT_ID_PATTERN.test(String(eventId || ""))) return false;
    return mutate(async () => {
      const pendingPath = path.join(paths.pending, `${eventId}.json`);
      const removed = await fsp.unlink(pendingPath).then(() => true).catch((error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      });
      await reconcileUnsafe();
      return removed;
    });
  }

  async function reject(eventId, reason = "terminal-http") {
    if (!EVENT_ID_PATTERN.test(String(eventId || ""))) return false;
    return mutate(async () => {
      const pendingPath = path.join(paths.pending, `${eventId}.json`);
      const failedPath = path.join(paths.failed, `${eventId}.json`);
      const event = await readJson(pendingPath);
      if (!event) return false;
      await atomicWrite(failedPath, { ...normalizeEvent(event), rejectedAt: nowIso(), rejectionReason: String(reason).slice(0, 96) });
      await fsp.unlink(pendingPath);
      await reconcileUnsafe();
      return true;
    });
  }

  return {
    acknowledge,
    abandonActive: () => mutate(async () => {
      let active;
      try {
        active = await readJson(paths.active);
      } catch {
        return fsp.rename(paths.active, path.join(paths.failed, `abandoned-corrupt-${Date.now()}.json`))
          .then(() => true)
          .catch((error) => error?.code === "ENOENT" ? false : Promise.reject(error));
      }
      if (!active) return false;
      await atomicWrite(path.join(paths.failed, `abandoned-${Date.now()}.json`), { ...active, abandonedAt: nowIso() });
      await fsp.unlink(paths.active).catch(() => {});
      return true;
    }),
    clearActive: () => mutate(() => fsp.unlink(paths.active).then(() => true).catch((error) => error?.code === "ENOENT" ? false : Promise.reject(error))),
    listPending: () => mutate(async () => (await reconcileUnsafe()).events),
    paths,
    playerKey,
    readSummary: () => mutate(async () => (await reconcileUnsafe()).summary),
    recordEvent,
    reject,
    writeActive: (active) => mutate(() => atomicWrite(paths.active, { ...active, schemaVersion: PLAY_TIME_SCHEMA_VERSION })),
  };
}

module.exports = {
  EVENT_ID_PATTERN,
  PLAY_TIME_SCHEMA_VERSION,
  createPlayTimeStore,
  emptySummary,
  normalizeEvent,
  normalizeSummary,
  playTimePaths,
};
