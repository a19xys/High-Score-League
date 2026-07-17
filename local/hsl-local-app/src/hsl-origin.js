const OFFICIAL_HSL_ORIGIN = "https://high-score-league.vercel.app";

function normalizeHslOrigin(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.includes("?") || candidate.includes("#")) return null;

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.origin === "null") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configurationResult(status, source, origin = null) {
  const message = status === "configured"
    ? "Origen HSL configurado."
    : status === "invalid"
      ? "El origen HSL configurado no es valido. Revisa la configuracion del launcher."
      : "El launcher no tiene un origen HSL configurado.";

  return {
    hslOrigin: origin,
    message,
    source,
    status,
  };
}

function resolveHslOrigin(options = {}) {
  const candidates = [
    ["environment", options.environmentOrigin],
    ["launcher-config", options.configuredOrigin],
    ["legacy-webBaseUrl", options.legacyWebBaseUrl],
    ["official-default", options.officialOrigin === undefined ? OFFICIAL_HSL_ORIGIN : options.officialOrigin],
  ];

  for (const [source, value] of candidates) {
    if (value === undefined || value === null) continue;
    const origin = normalizeHslOrigin(value);
    return origin
      ? configurationResult("configured", source, origin)
      : configurationResult("invalid", source);
  }

  return configurationResult("missing", "none");
}

module.exports = {
  OFFICIAL_HSL_ORIGIN,
  normalizeHslOrigin,
  resolveHslOrigin,
};
