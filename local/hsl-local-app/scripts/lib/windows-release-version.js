const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function assertStableVersion(version, label = "version") {
  if (typeof version !== "string" || !STABLE_SEMVER.test(version)) {
    throw new Error(`${label} debe ser SemVer estable MAJOR.MINOR.PATCH sin prefijo ni prerelease: ${String(version)}.`);
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${label} contiene un componente fuera del rango entero seguro: ${version}.`);
  }
  return parts;
}

function compareStableVersions(left, right) {
  const leftParts = assertStableVersion(left, "version candidata");
  const rightParts = assertStableVersion(right, "version anterior");
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function assertVersionIsNewer(candidate, previous) {
  if (compareStableVersions(candidate, previous) <= 0) {
    throw new Error(`La version candidata ${candidate} debe ser estrictamente superior a ${previous}.`);
  }
}

function tagForVersion(version) {
  assertStableVersion(version);
  return `v${version}`;
}

function versionFromTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) return null;
  const version = tag.slice(1);
  try {
    assertStableVersion(version);
    return version;
  } catch {
    return null;
  }
}

module.exports = {
  STABLE_SEMVER,
  assertStableVersion,
  assertVersionIsNewer,
  compareStableVersions,
  tagForVersion,
  versionFromTag,
};
