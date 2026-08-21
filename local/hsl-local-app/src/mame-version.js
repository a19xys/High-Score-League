function parseMameVersion(value) {
  const match = String(value || "").trim().match(/^(?:MAME\s+v?)?(\d+)\.(\d+)(?:\.(\d+))?$/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function compareMameVersions(left, right) {
  const a = parseMameVersion(left);
  const b = parseMameVersion(right);
  if (!a || !b) throw new Error(`Version MAME invalida: ${!a ? left : right}`);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) < (b[index] || 0) ? -1 : 1;
  }
  return 0;
}

function isMameVersionCompatible(actual, minimum) {
  if (!minimum) return true;
  try {
    return compareMameVersions(actual, minimum) >= 0;
  } catch {
    return false;
  }
}

function extractMameVersion(value) {
  const match = String(value || "").match(/(?:^|\s)(\d+\.\d+(?:\.\d+)?)(?=\s|$|\()/);
  return match ? match[1] : null;
}

function detectMameVersion(mameExecutablePath, options = {}) {
  const execFileSyncImpl = options.execFileSyncImpl || require("node:child_process").execFileSync;
  let output;
  try {
    output = execFileSyncImpl(mameExecutablePath, ["-version"], {
      encoding: "utf8",
      timeout: options.timeoutMs || 5000,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`No se pudo comprobar la version exacta de MAME: ${error.message}`);
  }
  const version = extractMameVersion(output);
  if (!version) throw new Error("MAME -version no devolvio una version reconocible.");
  return version;
}

module.exports = { compareMameVersions, detectMameVersion, extractMameVersion, isMameVersionCompatible, parseMameVersion };
