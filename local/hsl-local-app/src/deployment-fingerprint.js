const SUPPORTED_LAUNCHER_API_VERSION = 1;

function normalizeFingerprintValue(value, fallback = "unknown") {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(normalized) ? normalized : fallback;
}

function deploymentKey(deployment = {}) {
  return [
    normalizeFingerprintValue(deployment.build),
    normalizeFingerprintValue(deployment.environment),
    Number(deployment.apiVersion) || 0,
  ].join(":");
}

function deploymentFingerprintsMatch(left = {}, right = {}) {
  const leftBuild = normalizeFingerprintValue(left.build);
  const rightBuild = normalizeFingerprintValue(right.build);
  const buildKnown = leftBuild !== "unknown" && rightBuild !== "unknown";
  return (!buildKnown || leftBuild === rightBuild) &&
    normalizeFingerprintValue(left.environment) === normalizeFingerprintValue(right.environment) &&
    Number(left.apiVersion) === Number(right.apiVersion);
}

function readHealthDeployment(response) {
  return {
    apiVersion: Number(response?.headers?.get?.("x-hsl-launcher-api-version")) || null,
    build: normalizeFingerprintValue(response?.headers?.get?.("x-hsl-build")),
    environment: normalizeFingerprintValue(response?.headers?.get?.("x-hsl-environment")),
  };
}

function readRankingDeployment(payload = {}) {
  return {
    apiVersion: Number(payload.version) || null,
    build: normalizeFingerprintValue(payload.build),
    environment: normalizeFingerprintValue(payload.environment),
  };
}

module.exports = {
  SUPPORTED_LAUNCHER_API_VERSION,
  deploymentFingerprintsMatch,
  deploymentKey,
  normalizeFingerprintValue,
  readHealthDeployment,
  readRankingDeployment,
};
