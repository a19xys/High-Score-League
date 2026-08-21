export const DEFAULT_CANONICAL_SITE_ORIGIN = "https://highscoreleague.com";

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

function parseSiteOrigin(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());

    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function resolveCanonicalSiteOrigin(
  configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL,
  environment = process.env.NODE_ENV,
) {
  const parsed = parseSiteOrigin(configuredOrigin);

  if (!parsed) {
    return DEFAULT_CANONICAL_SITE_ORIGIN;
  }

  if (parsed.protocol === "https:") {
    return parsed.origin;
  }

  if (
    parsed.protocol === "http:" &&
    environment !== "production" &&
    isLoopbackHostname(parsed.hostname)
  ) {
    return parsed.origin;
  }

  return DEFAULT_CANONICAL_SITE_ORIGIN;
}

export const canonicalSiteOrigin = resolveCanonicalSiteOrigin();

export function resolveRecoveryRedirectOrigin(
  runtimeOrigin: string,
  environment = process.env.NODE_ENV,
  configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL,
) {
  const runtime = parseSiteOrigin(runtimeOrigin);

  if (
    environment !== "production" &&
    runtime &&
    (runtime.protocol === "http:" || runtime.protocol === "https:") &&
    isLoopbackHostname(runtime.hostname)
  ) {
    return runtime.origin;
  }

  return resolveCanonicalSiteOrigin(configuredOrigin, environment);
}
