const baseUrl = String(process.env.HSL_LAUNCHER_API_BASE_URL || "https://high-score-league.vercel.app").replace(/\/$/, "");
const weekId = String(process.env.HSL_LAUNCHER_WEEK_ID || "").trim();
const expectedDeploymentSha = String(process.env.HSL_EXPECTED_DEPLOYMENT_SHA || "").trim().toLowerCase();

if (!/^[A-Za-z0-9_-]{1,128}$/.test(weekId)) {
  throw new Error("Define HSL_LAUNCHER_WEEK_ID con una semana real para ejecutar esta comprobacion.");
}

const health = await fetch(`${baseUrl}/api/launcher/health`, { cache: "no-store" });
const healthBuild = String(health.headers.get("x-hsl-build") || "unknown");
const healthEnvironment = String(health.headers.get("x-hsl-environment") || "unknown");
const healthApiVersion = Number(health.headers.get("x-hsl-launcher-api-version"));

if (health.status !== 204 || (await health.text()) !== "") {
  throw new Error(`Health inesperado: HTTP ${health.status}.`);
}

if (healthApiVersion !== 1) {
  throw new Error(`Version health inesperada: ${healthApiVersion || "missing"}.`);
}

if (expectedDeploymentSha && !expectedDeploymentSha.startsWith(healthBuild.toLowerCase()) &&
    !healthBuild.toLowerCase().startsWith(expectedDeploymentSha)) {
  throw new Error(`Build desplegado inesperado: ${healthBuild}.`);
}

async function postBatch(requests) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/launcher/ranking-capabilities`, {
    body: JSON.stringify({ version: 1, requests }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await response.json();
  return { latencyMs: Math.round(performance.now() - startedAt), payload, response };
}

const empty = await postBatch([]);

if (empty.response.status !== 200 || empty.payload?.version !== 1 || empty.payload?.results?.length !== 0) {
  throw new Error(`Batch vacio inesperado: HTTP ${empty.response.status}.`);
}

const missingWeekId = "00000000-0000-4000-8000-000000000001";
const rankingResult = await postBatch([
  { requestKey: "real", weekId },
  { requestKey: "missing", weekId: missingWeekId },
]);
const ranking = rankingResult.response;
const payload = rankingResult.payload;

if (ranking.status !== 200 || payload?.version !== 1 || !Array.isArray(payload.results)) {
  const safeFailure = {
    code: typeof payload?.code === "string" ? payload.code : null,
    error: typeof payload?.error === "string" ? payload.error : null,
  };
  throw new Error(`Ranking batch inesperado: HTTP ${ranking.status} ${JSON.stringify(safeFailure)}.`);
}

if (payload.build !== healthBuild || payload.environment !== healthEnvironment) {
  throw new Error(`Health y Ranking no pertenecen al mismo build: ${healthBuild}/${payload.build}.`);
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
  build: healthBuild,
  environment: healthEnvironment,
  emptyLatencyMs: empty.latencyMs,
  healthStatus: health.status,
  launcherApiVersion: healthApiVersion,
  missingStatus: missing.status,
  rankingLatencyMs: rankingResult.latencyMs,
  rankingStatus: ranking.status,
  realStatus: real.status,
}, null, 2));
