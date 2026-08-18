const fsp = require("node:fs/promises");

async function canonicalPath(value) {
  return fsp.realpath(value);
}

module.exports = { canonicalPath };
