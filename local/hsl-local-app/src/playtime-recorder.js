const crypto = require("node:crypto");

function defaultMonotonicNow() {
  return process.hrtime.bigint();
}

function elapsedSeconds(start, end) {
  const nanoseconds = end > start ? end - start : 0n;
  return Number(nanoseconds / 1_000_000_000n);
}

function createPlayTimeRecorder(options = {}) {
  const monotonicNow = options.monotonicNow || defaultMonotonicNow;
  const dateNow = options.dateNow || (() => new Date());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const activeSessions = new Set();

  function prepare(input = {}) {
    if (!input.userId || !input.playerKey || !input.store) {
      return null;
    }

    const frozen = Object.freeze({
      clientVersion: input.clientVersion || null,
      eventId: randomUUID(),
      gameKey: String(input.gameKey || "").trim(),
      mode: input.mode,
      playerKey: input.playerKey,
      rom: input.rom || null,
      store: input.store,
      userId: input.userId,
      weekId: String(input.weekId || "").trim(),
    });
    if (!frozen.gameKey || !frozen.weekId || !["practice", "competition"].includes(frozen.mode)) {
      return null;
    }

    let accumulatedSeconds = 0;
    let activeFrom = null;
    let startedAt = null;
    let spawned = false;
    let finalizing = null;
    let activeWrite = Promise.resolve();

    function pause() {
      if (!spawned || activeFrom === null || finalizing) return;
      const now = monotonicNow();
      accumulatedSeconds += elapsedSeconds(activeFrom, now);
      activeFrom = null;
    }

    function resume() {
      if (!spawned || activeFrom !== null || finalizing) return;
      activeFrom = monotonicNow();
    }

    async function onSpawn() {
      if (spawned || finalizing) return;
      spawned = true;
      startedAt = dateNow().toISOString();
      activeFrom = monotonicNow();
      activeSessions.add(session);
      activeWrite = Promise.resolve(frozen.store.writeActive({
        clientVersion: frozen.clientVersion,
        eventId: frozen.eventId,
        gameKey: frozen.gameKey,
        mode: frozen.mode,
        playerKey: frozen.playerKey,
        rom: frozen.rom,
        startedAt,
        userId: frozen.userId,
        weekId: frozen.weekId,
      }));
      await activeWrite;
    }

    function finalize() {
      if (finalizing) return finalizing;
      if (!spawned) return Promise.resolve(null);
      finalizing = (async () => {
        if (activeFrom !== null) {
          accumulatedSeconds += elapsedSeconds(activeFrom, monotonicNow());
          activeFrom = null;
        }
        const observedEnd = dateNow();
        const endedAt = observedEnd.getTime() < Date.parse(startedAt)
          ? startedAt
          : observedEnd.toISOString();
        const event = {
          clientVersion: frozen.clientVersion,
          durationSeconds: Math.min(604800, Math.max(1, accumulatedSeconds)),
          endedAt,
          eventId: frozen.eventId,
          gameKey: frozen.gameKey,
          mode: frozen.mode,
          rom: frozen.rom,
          startedAt,
          weekId: frozen.weekId,
        };
        await activeWrite;
        await frozen.store.recordEvent(event);
        await frozen.store.clearActive();
        activeSessions.delete(session);
        return event;
      })();
      return finalizing;
    }

    const session = Object.freeze({
      context: frozen,
      finalize,
      onClose: finalize,
      onSpawn,
      pause,
      resume,
    });
    return session;
  }

  function pauseAll() {
    for (const session of activeSessions) session.pause();
  }

  function resumeAll() {
    for (const session of activeSessions) session.resume();
  }

  async function finalizeAll() {
    await Promise.allSettled([...activeSessions].map((session) => session.finalize()));
  }

  return {
    finalizeAll,
    getActiveCount: () => activeSessions.size,
    pauseAll,
    prepare,
    resumeAll,
  };
}

module.exports = { createPlayTimeRecorder, elapsedSeconds };
