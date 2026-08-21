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
    const spec = COMPETITION_PACK_ARGUMENT_SPECS[token];
    if (!spec) {
      throw new Error(`pack.json ${label} usa una opcion MAME no permitida en Competicion: ${token}. Muevela al perfil de Practica.`);
    }
    if (seen.has(token)) {
      throw new Error(`pack.json ${label} repite la opcion ${token} en Competicion.`);
    }
    seen.add(token);
    const values = args.slice(index + 1, index + 1 + spec.arity);
    if (values.length !== spec.arity || values.some((value) => normalizeMameOptionToken(value))) {
      throw new Error(`pack.json ${label} debe aportar ${spec.arity} valor(es) para ${token}.`);
    }
    if (!spec.validate(...values)) {
      throw new Error(`pack.json ${label} contiene un valor no permitido para ${token}; se esperaba ${spec.expected}.`);
    }
    result.push(token, ...values);
    index += 1 + spec.arity;
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
  return values;
}

module.exports = {
  COMPETITION_RESERVED_MAME_ARGUMENTS,
  COMPETITION_PACK_ARGUMENT_SPECS,
  RESERVED_MAME_ARGUMENTS,
  findCompetitionReservedMameArgument,
  findReservedMameArgument,
  normalizeMameOptionToken,
  validateCompetitionPackMameArguments,
  validatePackMameArguments,
};
