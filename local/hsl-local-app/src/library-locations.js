const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

function getLibraryLocationsFile(config) {
  if (!config?.userDataDir) {
    throw new Error("No se pudo resolver userDataDir para library locations.");
  }

  return path.join(config.userDataDir, "libraries", "locations.json");
}

function normalizeLocationPath(locationPath) {
  if (typeof locationPath !== "string" || locationPath.trim() === "") {
    return null;
  }

  return path.resolve(locationPath.trim());
}

function getLocationKey(locationPath, platform = process.platform) {
  const normalized = normalizeLocationPath(locationPath);

  if (!normalized) {
    return null;
  }

  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function createLocationId(locationPath) {
  const key = getLocationKey(locationPath) || locationPath;
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
  return `loc_${hash}`;
}

function emptyLocationsState(overrides = {}) {
  return {
    error: null,
    locations: [],
    locationsFile: overrides.locationsFile || null,
    schemaVersion: 1,
    updatedAt: null,
    ...overrides,
  };
}

function normalizeLocationEntry(entry) {
  const locationPath = normalizeLocationPath(entry?.path);

  if (!locationPath) {
    return null;
  }

  return {
    addedAt: typeof entry.addedAt === "string" ? entry.addedAt : null,
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id : createLocationId(locationPath),
    path: locationPath,
  };
}

async function readLibraryLocations(config) {
  const locationsFile = getLibraryLocationsFile(config);

  try {
    const raw = await fsp.readFile(locationsFile, "utf8");
    const parsed = JSON.parse(raw);
    const rawLocations = Array.isArray(parsed.locations) ? parsed.locations : [];
    const seen = new Set();
    const locations = [];

    for (const rawLocation of rawLocations) {
      const location = normalizeLocationEntry(rawLocation);
      const key = getLocationKey(location?.path);

      if (!location || !key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      locations.push(location);
    }

    return emptyLocationsState({
      locations,
      locationsFile,
      schemaVersion: parsed.schemaVersion || 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyLocationsState({ locationsFile });
    }

    return emptyLocationsState({
      error: `No se pudo leer locations.json: ${error.message}`,
      locationsFile,
    });
  }
}

async function writeLibraryLocations(config, locations, options = {}) {
  const locationsFile = getLibraryLocationsFile(config);
  const payload = {
    schemaVersion: 1,
    updatedAt: options.updatedAt || new Date().toISOString(),
    locations,
  };

  await fsp.mkdir(path.dirname(locationsFile), { recursive: true });
  await fsp.writeFile(locationsFile, JSON.stringify(payload, null, 2), "utf8");

  return emptyLocationsState({
    locations,
    locationsFile,
    updatedAt: payload.updatedAt,
  });
}

async function addLibraryLocation(config, locationPath, options = {}) {
  const normalizedPath = normalizeLocationPath(locationPath);

  if (!normalizedPath) {
    throw new Error("locationPath es obligatorio para añadir una ubicacion.");
  }

  const state = await readLibraryLocations(config);
  const key = getLocationKey(normalizedPath);
  const existing = state.locations.find((location) => getLocationKey(location.path) === key);

  if (existing) {
    return {
      added: false,
      duplicate: true,
      location: existing,
      state,
    };
  }

  const location = {
    addedAt: options.addedAt || new Date().toISOString(),
    id: createLocationId(normalizedPath),
    path: normalizedPath,
  };
  const nextState = await writeLibraryLocations(config, [...state.locations, location], options);

  return {
    added: true,
    duplicate: false,
    location,
    state: nextState,
  };
}

async function removeLibraryLocation(config, locationId, options = {}) {
  const state = await readLibraryLocations(config);
  const nextLocations = state.locations.filter((location) => location.id !== locationId);
  const removed = nextLocations.length !== state.locations.length;

  if (!removed) {
    return {
      removed: false,
      state,
    };
  }

  return {
    removed: true,
    state: await writeLibraryLocations(config, nextLocations, options),
  };
}

module.exports = {
  addLibraryLocation,
  createLocationId,
  getLibraryLocationsFile,
  getLocationKey,
  normalizeLocationPath,
  readLibraryLocations,
  removeLibraryLocation,
  writeLibraryLocations,
};
