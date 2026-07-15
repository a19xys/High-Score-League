import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GET as getLauncherHealth } from "../app/api/launcher/health/route.ts";
import {
  buildLauncherRankingResults,
  LAUNCHER_RANKING_BATCH_LIMIT,
  resolvePublicRankingCapability,
  validateLauncherRankingRequest,
  validLauncherRankingDatabaseWeekId,
} from "../lib/launcher-ranking-capabilities.ts";
import {
  getLauncherDeploymentFingerprint,
  LAUNCHER_API_VERSION,
} from "../lib/launcher-deployment.js";
import {
  classifyRankingBackendError,
  getSafeRankingProviderDiagnostic,
} from "../lib/launcher-ranking-diagnostics.ts";
import { loadLauncherRankingSource } from "../lib/launcher-ranking-source.ts";
import { getSupabaseAdminConfiguration } from "../lib/supabase/admin.ts";

const publicWeek = {
  id: "week-1",
  season_id: "season-1",
  game_id: "game-1",
  week_number: 1,
  status: "active",
};
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("launcher health is an unauthenticated empty 204 with no-store", async () => {
  const response = await getLauncherHealth();
  const source = await readFile(join(root, "app", "api", "launcher", "health", "route.ts"), "utf8");

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal(response.headers.get("x-hsl-launcher-api-version"), String(LAUNCHER_API_VERSION));
  assert.ok(response.headers.get("x-hsl-build"));
  assert.ok(response.headers.get("x-hsl-environment"));
  assert.doesNotMatch(source, /auth|getUser|cookie|Supabase/i);
  assert.doesNotMatch(source, /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/);
});

test("deployment fingerprint exposes only normalized non-sensitive identity", () => {
  assert.deepEqual(getLauncherDeploymentFingerprint({
    NODE_ENV: "production",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_SHA: "4aa31df04411dfeeffd0e5b2e536c91c0f87172a",
  }), {
    apiVersion: 1,
    build: "4aa31df04411",
    environment: "production",
  });
  assert.equal(JSON.stringify(getLauncherDeploymentFingerprint({})).includes("SUPABASE"), false);
});

test("validates versioned batches and duplicate request keys", () => {
  const valid = validateLauncherRankingRequest({
    version: 1,
    requests: [{ requestKey: "pack-a", weekId: "week-1" }],
  });
  const duplicate = validateLauncherRankingRequest({
    version: 1,
    requests: [
      { requestKey: "pack-a", weekId: "week-1" },
      { requestKey: "pack-a", weekId: "week-2" },
    ],
  });
  const oversized = validateLauncherRankingRequest({
    version: 1,
    requests: Array.from({ length: LAUNCHER_RANKING_BATCH_LIMIT + 1 }, (_, index) => ({
      requestKey: `request-${index}`,
      weekId: `week-${index}`,
    })),
  });

  assert.equal(valid.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(oversized.ok, false);
  assert.equal(validateLauncherRankingRequest({ version: 1, requests: [] }).ok, true);
  assert.equal(validateLauncherRankingRequest({ version: 2, requests: [] }).ok, false);
  assert.equal(validateLauncherRankingRequest({
    version: 1,
    requests: [{ requestKey: "bad key", weekId: "week-1" }],
  }).ok, false);
  assert.equal(validLauncherRankingDatabaseWeekId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(validLauncherRankingDatabaseWeekId("launcher-api-check-missing-week"), false);
});

test("public capability matches week visibility without requiring scores", () => {
  assert.deepEqual(resolvePublicRankingCapability({
    week: publicWeek,
    season: { id: "season-1", status: "active" },
    derivedStatus: "active",
    currentActiveWeekNumber: 1,
  }), { status: "available", reason: "public-week" });
  assert.equal(resolvePublicRankingCapability({
    week: { ...publicWeek, game_id: null },
    season: { id: "season-1", status: "active" },
    derivedStatus: "active",
  }).status, "unavailable");
  assert.equal(resolvePublicRankingCapability({
    week: publicWeek,
    season: { id: "season-1", status: "draft" },
    derivedStatus: "active",
  }).status, "unavailable");
  assert.equal(resolvePublicRankingCapability({
    week: { ...publicWeek, week_number: 2 },
    season: { id: "season-1", status: "active" },
    derivedStatus: "active",
    currentActiveWeekNumber: 1,
  }).status, "unavailable");
  assert.equal(resolvePublicRankingCapability({
    week: { ...publicWeek, status: "published", game_id: "game-1" },
    season: { id: "season-1", status: "completed" },
    derivedStatus: "published",
  }).status, "available");

  for (const derivedStatus of ["active", "final_stretch", "closed", "published"]) {
    assert.equal(resolvePublicRankingCapability({
      week: { ...publicWeek, status: derivedStatus },
      season: { id: "season-1", status: derivedStatus === "published" ? "completed" : "active" },
      derivedStatus,
      currentActiveWeekNumber: 1,
    }).status, "available");
  }

  for (const derivedStatus of ["draft", "scheduled"]) {
    assert.equal(resolvePublicRankingCapability({
      week: { ...publicWeek, status: derivedStatus },
      season: { id: "season-1", status: "active" },
      derivedStatus,
      currentActiveWeekNumber: 1,
    }).status, "unavailable");
  }

  assert.equal(resolvePublicRankingCapability({
    week: null,
    season: null,
    derivedStatus: null,
  }).reason, "not-found");
});


test("batch preserves correlation, duplicates week ids and canonical URLs", () => {
  const results = buildLauncherRankingResults({
    requests: [
      { requestKey: "instance-a", weekId: "week-1" },
      { requestKey: "instance-b", weekId: "week-1" },
      { requestKey: "missing", weekId: "week-missing" },
    ],
    weeks: [{ ...publicWeek, derivedStatus: "closed" }],
    seasons: [{ id: "season-1", status: "completed" }],
    origin: "https://hsl.example",
  });

  assert.equal(results[0].status, "available");
  assert.equal(results[0].url, "https://hsl.example/weeks/week-1");
  assert.equal(results[1].url, results[0].url);
  assert.deepEqual(results[2], {
    requestKey: "missing",
    status: "unavailable",
    url: null,
    reason: "not-found",
  });
});

test("ranking source batches queries and returns sanitized failure codes", async () => {
  const weeks = [{ ...publicWeek }];
  const calls: string[] = [];
  const source = await loadLauncherRankingSource({
    weekIds: ["week-1"],
    loadRequestedWeeks: async () => { calls.push("weeks"); return { data: weeks, error: null }; },
    loadSeasons: async () => { calls.push("seasons"); return { data: [{ id: "season-1", status: "active" }], error: null }; },
    loadSeasonWeeks: async () => { calls.push("season-weeks"); return { data: weeks, error: null }; },
    deriveStatus: () => "active",
  });
  assert.equal(source.ok, true);
  assert.deepEqual(calls, ["weeks", "seasons", "season-weeks"]);
  assert.equal(source.ok && source.activeWeekNumbers.get("season-1"), 1);

  const failures: Array<{ stage: string; operation: string; error: unknown }> = [];
  const failedWeeks = await loadLauncherRankingSource({
    weekIds: ["week-1"],
    loadRequestedWeeks: async () => ({ data: null, error: new Error("private database detail") }),
    loadSeasons: async () => ({ data: [], error: null }),
    loadSeasonWeeks: async () => ({ data: [], error: null }),
    deriveStatus: () => "active",
    onQueryFailure: (failure) => failures.push(failure),
  });
  assert.deepEqual(failedWeeks, { ok: false, code: "RANKING_WEEKS_QUERY_FAILED" });
  assert.equal(failures[0].stage, "weeks");
  assert.equal(failures[0].operation, "load-requested-weeks");

  const failedContext = await loadLauncherRankingSource({
    weekIds: ["week-1"],
    loadRequestedWeeks: async () => ({ data: weeks, error: null }),
    loadSeasons: async () => ({ data: null, error: new Error("private database detail") }),
    loadSeasonWeeks: async () => ({ data: weeks, error: null }),
    deriveStatus: () => "active",
  });
  assert.deepEqual(failedContext, { ok: false, code: "RANKING_CONTEXT_QUERY_FAILED" });
});

test("backend diagnostics classify provider failures without leaking credentials", () => {
  assert.equal(classifyRankingBackendError({ code: "PGRST301", message: "invalid JWT" }, "RANKING_WEEKS_QUERY_FAILED"),
    "RANKING_BACKEND_AUTH_FAILED");
  assert.equal(classifyRankingBackendError({ code: "42703", message: "column does not exist" }, "RANKING_WEEKS_QUERY_FAILED"),
    "RANKING_SCHEMA_MISMATCH");
  assert.equal(classifyRankingBackendError({ message: "TypeError: fetch failed ENOTFOUND" }, "RANKING_WEEKS_QUERY_FAILED"),
    "RANKING_BACKEND_TRANSPORT_FAILED");

  const diagnostic = getSafeRankingProviderDiagnostic({
    code: "22P02",
    details: "Bearer secret-token",
    hint: "service_role=secret-value",
    message: "invalid input syntax for type uuid",
  }, "RANKING_WEEKS_QUERY_FAILED");
  assert.equal(diagnostic.classification, "RANKING_WEEKS_QUERY_FAILED");
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret-token|secret-value/);
});

test("admin configuration reports missing server variables without exposing values", () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.deepEqual(getSupabaseAdminConfiguration(), {
      available: false,
      serviceRoleConfigured: false,
      supabaseUrlConfigured: false,
    });

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-value";
    assert.deepEqual(getSupabaseAdminConfiguration(), {
      available: true,
      serviceRoleConfigured: true,
      supabaseUrlConfigured: true,
    });
    assert.doesNotMatch(JSON.stringify(getSupabaseAdminConfiguration()), /server-only-value/);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousRole;
  }
});

test("page and endpoint consume the same public ranking helper", async () => {
  const [pageHelper, endpoint] = await Promise.all([
    readFile(join(root, "lib", "data", "week-detail.ts"), "utf8"),
    readFile(join(root, "app", "api", "launcher", "ranking-capabilities", "route.ts"), "utf8"),
  ]);

  assert.match(pageHelper, /resolvePublicRankingCapability/);
  assert.match(endpoint, /buildLauncherRankingResults/);
  assert.match(endpoint, /createSupabaseAdminClient/);
  assert.match(endpoint, /MAX_REQUEST_BYTES/);
  assert.match(endpoint, /RANKING_SERVICE_NOT_CONFIGURED/);
  assert.match(endpoint, /source\.code/);
  assert.match(endpoint, /validLauncherRankingDatabaseWeekId/);
  assert.match(endpoint, /launcher-ranking-query-failed/);
  assert.doesNotMatch(endpoint, /Authorization|request\.cookies|rankingUrl/);
});
