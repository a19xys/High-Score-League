const baseUrl = String(process.env.HSL_LAUNCHER_API_BASE_URL || "https://high-score-league.vercel.app").replace(/\/$/, "");
const weekId = String(process.env.HSL_LAUNCHER_WEEK_ID || "").trim();

if (!/^[A-Za-z0-9_-]{1,128}$/.test(weekId)) {
  throw new Error("Define HSL_LAUNCHER_WEEK_ID con una semana real para ejecutar esta comprobacion.");
}

const health = await fetch(`${baseUrl}/api/launcher/health`, { cache: "no-store" });

if (health.status !== 204 || (await health.text()) !== "") {
  throw new Error(`Health inesperado: HTTP ${health.status}.`);
}

const missingWeekId = "launcher-api-check-missing-week";
const ranking = await fetch(`${baseUrl}/api/launcher/ranking-capabilities`, {
  body: JSON.stringify({
    version: 1,
    requests: [
      { requestKey: "real", weekId },
      { requestKey: "missing", weekId: missingWeekId },
    ],
  }),
  cache: "no-store",
  headers: { "content-type": "application/json" },
  method: "POST",
});
const payload = await ranking.json();

if (ranking.status !== 200 || payload?.version !== 1 || !Array.isArray(payload.results)) {
  const safeFailure = {
    code: typeof payload?.code === "string" ? payload.code : null,
    error: typeof payload?.error === "string" ? payload.error : null,
  };
  throw new Error(`Ranking batch inesperado: HTTP ${ranking.status} ${JSON.stringify(safeFailure)}.`);
}

const real = payload.results.find((item) => item.requestKey === "real");
const missing = payload.results.find((item) => item.requestKey === "missing");

if (real?.status !== "available" || !String(real.url || "").startsWith(`${baseUrl}/weeks/`)) {
  throw new Error(`La semana real no esta disponible: ${JSON.stringify(real)}`);
}

if (missing?.status !== "unavailable" || missing.reason !== "not-found" || missing.url !== null) {
  throw new Error(`La semana inexistente no devolvio unavailable: ${JSON.stringify(missing)}`);
}

const raw = JSON.stringify(payload);

if (/player|profile|submission|score|membership|service.role|token/i.test(raw)) {
  throw new Error("La respuesta contiene campos que no pertenecen al contrato publico.");
}

console.log(JSON.stringify({
  baseUrl,
  healthStatus: health.status,
  missingStatus: missing.status,
  rankingStatus: ranking.status,
  realStatus: real.status,
}, null, 2));
