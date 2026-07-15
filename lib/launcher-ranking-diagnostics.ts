export type RankingBackendClassification =
  | "RANKING_BACKEND_AUTH_FAILED"
  | "RANKING_BACKEND_PROJECT_MISMATCH"
  | "RANKING_SCHEMA_MISMATCH"
  | "RANKING_BACKEND_TRANSPORT_FAILED"
  | "RANKING_WEEKS_QUERY_FAILED"
  | "RANKING_CONTEXT_QUERY_FAILED";

type ProviderError = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function sanitizeProviderText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/(?:service[_ -]?role|authorization|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .trim();
  return normalized ? normalized.slice(0, 240) : null;
}

export function classifyRankingBackendError(
  error: unknown,
  fallback: "RANKING_WEEKS_QUERY_FAILED" | "RANKING_CONTEXT_QUERY_FAILED",
): RankingBackendClassification {
  const provider = (error && typeof error === "object" ? error : {}) as ProviderError;
  const code = String(provider.code || "").toUpperCase();
  const status = Number(provider.status || provider.statusCode || 0);
  const text = [provider.message, provider.details, provider.hint].map(String).join(" ").toLowerCase();

  if (/project.+mismatch|issuer.+mismatch/.test(text)) return "RANKING_BACKEND_PROJECT_MISMATCH";
  if (status === 401 || code === "PGRST301" || /invalid.+jwt|jwt.+invalid|unauthorized/.test(text)) {
    return "RANKING_BACKEND_AUTH_FAILED";
  }
  if (["42P01", "42703", "PGRST204"].includes(code) || /column.+does not exist|relation.+does not exist/.test(text)) {
    return "RANKING_SCHEMA_MISMATCH";
  }
  if (/fetch failed|econn|enotfound|etimedout|network|socket/.test(`${code} ${text}`)) {
    return "RANKING_BACKEND_TRANSPORT_FAILED";
  }
  return fallback;
}

export function getSafeRankingProviderDiagnostic(
  error: unknown,
  fallback: "RANKING_WEEKS_QUERY_FAILED" | "RANKING_CONTEXT_QUERY_FAILED",
) {
  const provider = (error && typeof error === "object" ? error : {}) as ProviderError;
  const providerCode = String(provider.code || "").toUpperCase();
  const providerStatus = Number(provider.status || provider.statusCode || 0);

  return {
    classification: classifyRankingBackendError(error, fallback),
    details: sanitizeProviderText(provider.details),
    hint: sanitizeProviderText(provider.hint),
    message: sanitizeProviderText(provider.message),
    providerCode: /^[A-Z0-9_]{1,32}$/.test(providerCode) ? providerCode : null,
    providerStatus: Number.isInteger(providerStatus) && providerStatus > 0 ? providerStatus : null,
  };
}

