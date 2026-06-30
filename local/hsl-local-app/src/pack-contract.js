const path = require("node:path");

const V1_DEPRECATION_REASON = "packVersion 1 puede declarar MAME dentro del pack y sera sustituido por packVersion 2 con runtime compartido.";
const V1_DEPRECATION_WARNING = "Este pack usa packVersion 1, un contrato legacy/deprecated. Seguira funcionando temporalmente, pero sera sustituido por packVersion 2 con MAME compartido.";

const V2_REQUIRED_FIELDS = [
  "packVersion",
  "packId",
  "gameId",
  "rom",
  "weekId",
  "webBaseUrl",
];

const V2_RECOMMENDED_FIELDS = [
  "seasonId",
  "seasonSlug",
  "seasonName",
  "weekNumber",
  "runtime.minVersion",
  "runtime.recommendedVersion",
  "mame.artworkPath",
  "mame.samplePath",
  "mame.cfgPath",
  "capture.pluginName",
  "capture.adapter",
];
const V2_MAME_PROFILE_MODES = ["practice", "competition"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function getNestedValue(source, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), source);
}

function hasUrlScheme(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function hasParentSegment(value) {
  return value.split(/[\\/]+/).some((part) => part === "..");
}

function isUnsafePackRelativePath(value) {
  if (!isNonEmptyString(value)) {
    return true;
  }

  const trimmed = value.trim();

  return trimmed.includes("\0") ||
    hasUrlScheme(trimmed) ||
    path.isAbsolute(trimmed) ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    /^[\\/]/.test(trimmed) ||
    hasParentSegment(trimmed);
}

function normalizeRelativePath(value) {
  return isNonEmptyString(value) ? value.trim().replace(/\\/g, "/") : null;
}

function resolvePackResourcePath(value, packRoot) {
  if (!isNonEmptyString(value) || !packRoot) {
    return null;
  }

  return path.resolve(packRoot, value.trim());
}

function addMissingFieldErrors(pack, fields, errors) {
  for (const field of fields) {
    if (isBlank(getNestedValue(pack, field))) {
      errors.push(`pack.json debe incluir ${field}`);
    }
  }
}

function addRecommendedFieldWarnings(pack, fields, warnings) {
  for (const field of fields) {
    if (isBlank(getNestedValue(pack, field))) {
      warnings.push(`pack.json recomienda incluir ${field}`);
    }
  }
}

function validateLocalPathField(pack, field, errors, options = {}) {
  const value = getNestedValue(pack, field);

  if (isBlank(value)) {
    if (options.required) {
      errors.push(`pack.json debe incluir ${field}`);
    }
    return null;
  }

  if (!isNonEmptyString(value)) {
    errors.push(`pack.json ${field} debe ser una ruta relativa dentro del pack`);
    return null;
  }

  if (isUnsafePackRelativePath(value)) {
    errors.push(`pack.json ${field} debe ser una ruta relativa segura dentro del pack`);
    return null;
  }

  return normalizeRelativePath(value);
}

function validateLaunchArgsField(pack, field, errors) {
  const value = getNestedValue(pack, field);

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push(`pack.json ${field} debe ser un array`);
    return [];
  }

  return value.filter((item) => {
    if (typeof item !== "string" || item.includes("\0")) {
      errors.push(`pack.json ${field} solo puede incluir strings seguros`);
      return false;
    }

    return true;
  });
}

function normalizeMameProfiles(pack, packRoot, errors) {
  const profiles = {};

  if (pack.mame?.profiles !== undefined && !isObject(pack.mame.profiles)) {
    errors.push("pack.json mame.profiles debe ser un objeto");
    return profiles;
  }

  for (const mode of V2_MAME_PROFILE_MODES) {
    const profile = pack.mame?.profiles?.[mode];

    if (profile === undefined) {
      profiles[mode] = {
        cfgDir: null,
        cfgPath: null,
        launchArgs: [],
      };
      continue;
    }

    if (!isObject(profile)) {
      errors.push(`pack.json mame.profiles.${mode} debe ser un objeto`);
      profiles[mode] = {
        cfgDir: null,
        cfgPath: null,
        launchArgs: [],
      };
      continue;
    }

    const cfgPath = validateLocalPathField(pack, `mame.profiles.${mode}.cfgPath`, errors);

    profiles[mode] = {
      cfgDir: resolvePackResourcePath(cfgPath, packRoot),
      cfgPath,
      launchArgs: validateLaunchArgsField(pack, `mame.profiles.${mode}.launchArgs`, errors),
    };
  }

  return profiles;
}

function baseNormalized(pack, overrides) {
  return {
    contractStatus: overrides.contractStatus,
    deprecated: overrides.deprecated,
    deprecationReason: overrides.deprecationReason || null,
    gameId: pack?.gameId || null,
    packId: pack?.packId || null,
    packVersion: pack?.packVersion || null,
    replacement: overrides.replacement || null,
    rom: pack?.rom || null,
    seasonId: pack?.seasonId || null,
    seasonName: pack?.seasonName || null,
    seasonSlug: pack?.seasonSlug || null,
    webBaseUrl: pack?.webBaseUrl || null,
    weekId: pack?.weekId || null,
    weekNumber: pack?.weekNumber || null,
  };
}

function normalizeV1Pack(pack, options = {}) {
  const errors = [];
  const warnings = [V1_DEPRECATION_WARNING];

  addMissingFieldErrors(pack, ["packVersion", "gameId", "rom", "weekId", "webBaseUrl", "mame"], errors);

  if (pack.mame && !isObject(pack.mame)) {
    errors.push("pack.json mame debe ser un objeto");
  } else if (pack.mame) {
    if (!pack.mame.relativeExecutablePath && !pack.mame.executablePath) {
      errors.push("pack.json mame debe incluir relativeExecutablePath");
    }

    if (!pack.mame.workingDir) {
      errors.push("pack.json mame debe incluir workingDir");
    }
  }

  const packRoot = options.packRoot || null;
  const normalized = {
    ...baseNormalized(pack, {
      contractStatus: "deprecated",
      deprecated: true,
      deprecationReason: V1_DEPRECATION_REASON,
      replacement: "packVersion 2",
    }),
    contract: {
      version: 1,
      runtimeType: "mame",
      legacyEmbeddedMame: true,
      mame: {
        executablePath: packRoot ? resolvePackResourcePath(pack?.mame?.relativeExecutablePath || pack?.mame?.executablePath, packRoot) : null,
        relativeExecutablePath: pack?.mame?.relativeExecutablePath || null,
        workingDir: packRoot ? resolvePackResourcePath(pack?.mame?.workingDir, packRoot) : null,
        workingDirPath: pack?.mame?.workingDir || null,
      },
      capture: {
        mode: "plugin",
        pluginName: pack?.mame?.pluginName || pack?.plugin?.name || "hsl-score",
      },
    },
  };

  return {
    errors,
    normalized,
    warnings,
  };
}

function normalizeV2Pack(pack, options = {}) {
  const errors = [];
  const warnings = [];

  addMissingFieldErrors(pack, V2_REQUIRED_FIELDS, errors);

  if (!isObject(pack.runtime)) {
    errors.push("pack.json debe incluir runtime");
  } else if (pack.runtime.type !== "mame") {
    errors.push("pack.json runtime.type debe ser mame");
  }

  if (!isObject(pack.mame)) {
    errors.push("pack.json debe incluir mame");
  }

  if (!isObject(pack.capture)) {
    errors.push("pack.json debe incluir capture");
  }

  if (pack.mame?.relativeExecutablePath || pack.mame?.executablePath || pack.mame?.workingDir) {
    errors.push("packVersion 2 no acepta mame.relativeExecutablePath, mame.executablePath ni mame.workingDir; usa runtime compartido y rutas de recursos relativas.");
  }

  const romPath = validateLocalPathField(pack, "mame.romPath", errors, { required: true });
  const artworkPath = validateLocalPathField(pack, "mame.artworkPath", errors);
  const samplePath = validateLocalPathField(pack, "mame.samplePath", errors);
  const cfgPath = validateLocalPathField(pack, "mame.cfgPath", errors);
  const adapter = validateLocalPathField(pack, "capture.adapter", errors);

  if (isBlank(pack.capture?.mode)) {
    errors.push("pack.json debe incluir capture.mode");
  }

  const launchArgs = validateLaunchArgsField(pack, "mame.launchArgs", errors);

  addRecommendedFieldWarnings(pack, V2_RECOMMENDED_FIELDS, warnings);

  const packRoot = options.packRoot || null;
  const profiles = normalizeMameProfiles(pack, packRoot, errors);
  const normalized = {
    ...baseNormalized(pack, {
      contractStatus: "current",
      deprecated: false,
    }),
    contract: {
      version: 2,
      runtimeType: pack.runtime?.type || null,
      runtime: {
        type: pack.runtime?.type || null,
        minVersion: pack.runtime?.minVersion || null,
        recommendedVersion: pack.runtime?.recommendedVersion || null,
      },
      mame: {
        artworkDir: resolvePackResourcePath(artworkPath, packRoot),
        artworkPath,
        cfgDir: resolvePackResourcePath(cfgPath, packRoot),
        cfgPath,
        launchArgs,
        profiles,
        romDir: resolvePackResourcePath(romPath, packRoot),
        romPath,
        sampleDir: resolvePackResourcePath(samplePath, packRoot),
        samplePath,
      },
      capture: {
        adapter,
        adapterPath: resolvePackResourcePath(adapter, packRoot),
        mode: pack.capture?.mode || null,
        pluginName: pack.capture?.pluginName || null,
      },
    },
  };

  return {
    errors,
    normalized,
    warnings,
  };
}

function normalizePackContract(pack, options = {}) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    return {
      errors: ["pack.json debe contener un objeto JSON"],
      normalized: null,
      warnings: [],
    };
  }

  if (pack.packVersion === 1) {
    return normalizeV1Pack(pack, options);
  }

  if (pack.packVersion === 2) {
    return normalizeV2Pack(pack, options);
  }

  const errors = [];

  if (isBlank(pack.packVersion)) {
    errors.push("pack.json debe incluir packVersion");
  } else {
    errors.push("pack.json packVersion debe ser 1 o 2");
  }

  return {
    errors,
    normalized: baseNormalized(pack, {
      contractStatus: "unsupported",
      deprecated: false,
    }),
    warnings: [],
  };
}

module.exports = {
  V1_DEPRECATION_REASON,
  V1_DEPRECATION_WARNING,
  V2_RECOMMENDED_FIELDS,
  V2_REQUIRED_FIELDS,
  isUnsafePackRelativePath,
  normalizePackContract,
};
