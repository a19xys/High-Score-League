const RESERVED_MAME_ARGUMENTS = Object.freeze(new Set([
  "rompath", "rp", "biospath", "bp",
  "artpath", "artworkdirectory",
  "samplepath", "sp",
  "bgfxpath", "hlslpath", "hashpath", "hashdirectory", "hash",
  "ctrlrpath", "ctrlrdirectory", "fontpath", "languagepath", "inipath",
  "homepath", "pluginspath", "plugin", "noplugin", "plugins", "noplugins",
  "cfgdirectory", "nvramdirectory", "inputdirectory", "statedirectory",
  "snapshotdirectory", "diffdirectory", "commentdirectory", "sharedirectory",
]));

const COMPETITION_RESERVED_MAME_ARGUMENTS = Object.freeze(new Set([
  "ctrlr", "ctrlrpath", "ctrlrdirectory",
  "rewind", "norewind", "rewindcapacity",
  "state", "autosave", "noautosave", "playback", "exitafterplayback", "statename",
  "cheat", "nocheat", "cheatpath",
  "throttle", "nothrottle", "speed", "refreshspeed", "norefreshspeed", "syncrefresh", "nosyncrefresh",
  "debug", "nodebug", "debugger", "debugscript", "debuglog", "debuggerhost", "debuggerport",
  "autobootscript", "autobootcommand", "autobootdelay",
  "console", "noconsole",
  "http", "nohttp", "httpport", "httproot",
  "plugin", "plugins", "noplugin", "noplugins", "pluginspath",
  "bench",
]));

const COMPETITION_PACK_ARGUMENT_SPECS = Object.freeze({
  "-video": Object.freeze({
    arity: 1,
    validate(value) {
      return value === "bgfx";
    },
    expected: "bgfx",
  }),
  "-bgfx_screen_chains": Object.freeze({
    arity: 1,
    validate(value) {
      return typeof value === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._,+-]{0,127}$/.test(value);
    },
    expected: "un nombre de chain BGFX seguro",
  }),
});

function normalizeMameOptionToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!/^(?:--?|\/)[A-Za-z]/.test(token)) return null;
  const withoutPrefix = token.replace(/^(?:--?|\/)/, "");
  const name = withoutPrefix.split(/[=:]/, 1)[0];
  return name.toLowerCase().replace(/[_-]/g, "");
}

function parseMameOptionToken(value) {
  const option = normalizeMameOptionToken(value);
  if (!option) return null;
  const token = value.trim();
  const withoutPrefix = token.replace(/^(?:--?|\/)/, "");
  const separator = withoutPrefix.search(/[=:]/);
  return {
    inlineValue: separator === -1 ? null : withoutPrefix.slice(separator + 1),
    option,
  };
}

const COMPETITION_PACK_ARGUMENT_BY_NORMALIZED_OPTION = Object.freeze({
  bgfxscreenchains: "-bgfx_screen_chains",
  video: "-video",
});

function normalizeVisualMameArguments(values) {
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const parsed = parseMameOptionToken(values[index]);
    const canonical = parsed && COMPETITION_PACK_ARGUMENT_BY_NORMALIZED_OPTION[parsed.option];
    if (!canonical) {
      result.push(values[index]);
      continue;
    }
    result.push(canonical);
    if (parsed.inlineValue !== null) result.push(parsed.inlineValue);
    else if (index + 1 < values.length) result.push(values[++index]);
  }
  return result;
}

function findReservedMameArgument(args) {
  if (!Array.isArray(args)) return null;
  for (const token of args) {
    const option = normalizeMameOptionToken(token);
    if (option && RESERVED_MAME_ARGUMENTS.has(option)) return { option, token };
  }
  return null;
}

function findCompetitionReservedMameArgument(args) {
  if (!Array.isArray(args)) return null;
  for (const token of args) {
    const option = normalizeMameOptionToken(token);
    if (option && COMPETITION_RESERVED_MAME_ARGUMENTS.has(option)) return { option, token };
  }
  return null;
}

function validateCompetitionPackMameArguments(args, label = "mame.launchArgs") {
  const result = [];
  const seen = new Set();

  for (let index = 0; index < args.length;) {
    const token = args[index];
    const parsed = parseMameOptionToken(token);
    const canonical = parsed && COMPETITION_PACK_ARGUMENT_BY_NORMALIZED_OPTION[parsed.option];
    const spec = canonical && COMPETITION_PACK_ARGUMENT_SPECS[canonical];
    if (!spec) {
      throw new Error(`pack.json ${label} usa una opcion MAME no permitida en Competicion: ${token}. Muevela al perfil de Practica.`);
    }
    if (seen.has(canonical)) {
      throw new Error(`pack.json ${label} repite la opcion ${canonical} en Competicion.`);
    }
    seen.add(canonical);
    const values = parsed.inlineValue === null
      ? args.slice(index + 1, index + 1 + spec.arity)
      : [parsed.inlineValue];
    if (values.length !== spec.arity || values.some((value) => normalizeMameOptionToken(value))) {
      throw new Error(`pack.json ${label} debe aportar ${spec.arity} valor(es) para ${canonical}.`);
    }
    if (!spec.validate(...values)) {
      throw new Error(`pack.json ${label} contiene un valor no permitido para ${canonical}; se esperaba ${spec.expected}.`);
    }
    result.push(canonical, ...values);
    index += parsed.inlineValue === null ? 1 + spec.arity : 1;
  }

  return result;
}

function validatePackMameArguments(args, label = "mame.launchArgs", options = {}) {
  if (args === undefined || args === null) return [];
  if (!Array.isArray(args)) throw new Error(`pack.json ${label} debe ser un array`);
  const values = args.map((value) => {
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error(`pack.json ${label} solo puede incluir strings seguros`);
    }
    return value;
  });
  const reserved = findReservedMameArgument(values);
  if (reserved) {
    throw new Error(`pack.json ${label} no puede controlar la opcion reservada ${reserved.token}`);
  }
  if (options.mode === "competition") {
    return validateCompetitionPackMameArguments(values, label);
  }
  return normalizeVisualMameArguments(values);
}

module.exports = {
  COMPETITION_RESERVED_MAME_ARGUMENTS,
  COMPETITION_PACK_ARGUMENT_SPECS,
  RESERVED_MAME_ARGUMENTS,
  findCompetitionReservedMameArgument,
  findReservedMameArgument,
  normalizeMameOptionToken,
  normalizeVisualMameArguments,
  parseMameOptionToken,
  validateCompetitionPackMameArguments,
  validatePackMameArguments,
};
