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

function validatePackMameArguments(args, label = "mame.launchArgs") {
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
  return values;
}

module.exports = {
  RESERVED_MAME_ARGUMENTS,
  findReservedMameArgument,
  normalizeMameOptionToken,
  validatePackMameArguments,
};
