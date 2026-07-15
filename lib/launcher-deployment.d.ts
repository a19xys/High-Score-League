export const LAUNCHER_API_VERSION: 1;

export interface LauncherDeploymentFingerprint {
  apiVersion: 1;
  build: string;
  environment: string;
}

export function getLauncherDeploymentFingerprint(
  env?: Record<string, string | undefined>,
): LauncherDeploymentFingerprint;

export function getLauncherDeploymentHeaders(
  env?: Record<string, string | undefined>,
): Record<string, string>;
