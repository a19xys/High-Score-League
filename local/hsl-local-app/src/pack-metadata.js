const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ASSET_EXTENSIONS = {
  cover: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  hero: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  icon: new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]),
  logo: new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]),
};

const TEXT_FIELDS = [
  "title",
  "subtitle",
  "developer",
  "publisher",
  "shortDescription",
  "manualUrl",
  "rankingUrl",
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanYear(value, warnings) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d{4}$/.test(value.trim())) {
    return Number(value.trim());
  }

  warnings.push("metadata.json: year debe ser un numero entero o una cadena YYYY.");
  return null;
}

function cleanGenre(value, warnings) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const rawItems = Array.isArray(value) ? value : [value];
  const items = rawItems
    .map(cleanString)
    .filter(Boolean);

  if (items.length === 0 && rawItems.length > 0) {
    warnings.push("metadata.json: genre debe contener texto.");
  }

  return items;
}

function isInside(parentDir, childPath) {
  const relative = path.relative(parentDir, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function rejectAsset(reason, warnings) {
  warnings.push(reason);
  return null;
}

function resolveAsset(kind, value, packDir, warnings) {
  const raw = cleanString(value);

  if (!raw) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw)) {
    return rejectAsset(`metadata.json: assets.${kind} debe ser una ruta relativa dentro del pack.`, warnings);
  }

  const normalized = path.normalize(raw);

  if (normalized === "." || normalized.startsWith(`..${path.sep}`) || normalized === "..") {
    return rejectAsset(`metadata.json: assets.${kind} no puede salir de la carpeta del pack.`, warnings);
  }

  const resolved = path.resolve(packDir, normalized);

  if (!isInside(packDir, resolved)) {
    return rejectAsset(`metadata.json: assets.${kind} no puede salir de la carpeta del pack.`, warnings);
  }

  const extension = path.extname(resolved).toLowerCase();
  const allowed = ASSET_EXTENSIONS[kind] || new Set();

  if (!allowed.has(extension)) {
    return rejectAsset(`metadata.json: assets.${kind} usa una extension no admitida: ${extension || "sin extension"}.`, warnings);
  }

  if (!fs.existsSync(resolved)) {
    warnings.push(`metadata.json: assets.${kind} no existe en el pack: ${raw}.`);
    return null;
  }

  return {
    extension,
    fullPath: resolved,
    relativePath: raw.replaceAll("\\", "/"),
    url: pathToFileURL(resolved).href,
  };
}

function normalizeMetadata(raw, packDir) {
  const warnings = [];

  if (!isPlainObject(raw)) {
    return {
      metadata: null,
      warnings: ["metadata.json debe contener un objeto JSON."],
    };
  }

  const metadata = {};

  for (const field of TEXT_FIELDS) {
    const value = cleanString(raw[field]);

    if (value) {
      metadata[field] = value;
    }
  }

  const year = cleanYear(raw.year, warnings);
  if (year) {
    metadata.year = year;
  }

  const genre = cleanGenre(raw.genre, warnings);
  if (genre.length > 0) {
    metadata.genre = genre;
  }

  if (raw.assets !== undefined && !isPlainObject(raw.assets)) {
    warnings.push("metadata.json: assets debe ser un objeto.");
  }

  const assets = {};
  const sourceAssets = isPlainObject(raw.assets) ? raw.assets : {};

  for (const kind of Object.keys(ASSET_EXTENSIONS)) {
    const asset = resolveAsset(kind, sourceAssets[kind], packDir, warnings);

    if (asset) {
      assets[kind] = asset;
    }
  }

  if (Object.keys(assets).length > 0) {
    metadata.assets = assets;
  }

  return {
    metadata,
    warnings,
  };
}

function loadPackMetadata(packDir) {
  const metadataPath = path.join(packDir, "metadata.json");

  if (!fs.existsSync(metadataPath)) {
    return {
      loaded: false,
      metadata: null,
      metadataPath,
      warnings: [],
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const normalized = normalizeMetadata(raw, packDir);

    return {
      loaded: Boolean(normalized.metadata),
      metadata: normalized.metadata,
      metadataPath,
      warnings: normalized.warnings,
    };
  } catch (error) {
    return {
      loaded: false,
      metadata: null,
      metadataPath,
      warnings: [`metadata.json no se pudo leer: ${error.message}`],
    };
  }
}

module.exports = {
  ASSET_EXTENSIONS,
  loadPackMetadata,
  normalizeMetadata,
  resolveAsset,
};
