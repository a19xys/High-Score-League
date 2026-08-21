const SUPPORTED_LAUNCHER_API_VERSION = 1;

function normalizeFingerprintValue(value, fallback = "unknown") {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(normalized) ? normalized : fallback;
}

function diagnosticDeploymentKey(deployment = {}) {
  return [
    normalizeFingerprintValue(deployment.build),
    normalizeFingerprintValue(deployment.environment),
    Number(deployment.apiVersion) || 0,
  ].join(":");
}

function launcherAuthorityKey(apiVersion = SUPPORTED_LAUNCHER_API_VERSION) {
  const version = Number(apiVersion);
  return Number.isInteger(version) && version > 0 ? `launcher-api:${version}` : null;
}

function isSupportedLauncherApiVersion(value) {
  return Number(value) === SUPPORTED_LAUNCHER_API_VERSION;
}

function launcherContractsCompatible(...deployments) {
  return deployments.length > 0 && deployments.every((deployment) => (
    isSupportedLauncherApiVersion(deployment?.apiVersion)
  ));
}

function deploymentMetadataExactlyMatches(left = {}, right = {}) {
  return normalizeFingerprintValue(left.build) === normalizeFingerprintValue(right.build) &&
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
  diagnosticDeploymentKey,
  deploymentMetadataExactlyMatches,
  isSupportedLauncherApiVersion,
  launcherAuthorityKey,
  launcherContractsCompatible,
  normalizeFingerprintValue,
  readHealthDeployment,
  readRankingDeployment,
};
