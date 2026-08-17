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

module.exports = { compareMameVersions, isMameVersionCompatible, parseMameVersion };
