function defaultScopeKey(config = {}) {
  return String(
    config.packDirectoryFile
    || config.userDataDir
    || config.appDir
    || "default"
  );
}

function createLibrarySnapshotAuthority({ scan, scopeKey = defaultScopeKey } = {}) {
  if (typeof scan !== "function") throw new TypeError("scan must be a function");
  const entries = new Map();

  function entryFor(config) {
    const key = scopeKey(config);
    let entry = entries.get(key);
    if (!entry) {
      entry = { generation: 0, inFlight: null, snapshot: null };
      entries.set(key, entry);
    }
    return entry;
  }

  async function refresh(config) {
    const entry = entryFor(config);
    const generation = entry.generation + 1;
    entry.generation = generation;
    const run = Promise.resolve().then(() => scan(config));
    entry.inFlight = run;
    try {
      const snapshot = await run;
      if (entry.generation === generation) entry.snapshot = snapshot;
      return entry.generation === generation ? snapshot : entry.snapshot || snapshot;
    } finally {
      if (entry.inFlight === run) entry.inFlight = null;
    }
  }

  async function read(config, options = {}) {
    const entry = entryFor(config);
    if (options.refresh === true) return refresh(config);
    if (entry.snapshot) return entry.snapshot;
    if (entry.inFlight) return entry.inFlight;
    return refresh(config);
  }

  function commit(config, snapshot) {
    const entry = entryFor(config);
    entry.generation += 1;
    entry.snapshot = snapshot;
    return snapshot;
  }

  function invalidate(config) {
    if (config) entries.delete(scopeKey(config));
    else entries.clear();
  }

  function inspect(config) {
    const entry = entries.get(scopeKey(config));
    return {
      cached: Boolean(entry?.snapshot),
      generation: entry?.generation || 0,
      inFlight: Boolean(entry?.inFlight),
    };
  }

  return { commit, inspect, invalidate, read, refresh };
}

module.exports = {
  createLibrarySnapshotAuthority,
  defaultScopeKey,
};
