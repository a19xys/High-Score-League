export const LAUNCHER_API_VERSION = 1;

function safeIdentifier(value, maxLength = 64) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._-]+$/.test(normalized)
    ? normalized.slice(0, maxLength)
    : null;
}

export function getLauncherDeploymentFingerprint(env = process.env) {
  const commitSha = safeIdentifier(env.VERCEL_GIT_COMMIT_SHA, 40);
  const deploymentId = safeIdentifier(env.VERCEL_DEPLOYMENT_ID, 64);
  const explicitBuild = safeIdentifier(env.HSL_BUILD_VERSION, 64);
  const vercelEnvironment = safeIdentifier(env.VERCEL_ENV, 16);
  const nodeEnvironment = safeIdentifier(env.NODE_ENV, 16);

  return {
    apiVersion: LAUNCHER_API_VERSION,
    build: commitSha?.slice(0, 12) || deploymentId || explicitBuild || "unknown",
    environment: vercelEnvironment || nodeEnvironment || "development",
  };
}

export function getLauncherDeploymentHeaders(env = process.env) {
  const fingerprint = getLauncherDeploymentFingerprint(env);
  return {
    "X-HSL-Build": fingerprint.build,
    "X-HSL-Environment": fingerprint.environment,
    "X-HSL-Launcher-Api-Version": String(fingerprint.apiVersion),
  };
}
