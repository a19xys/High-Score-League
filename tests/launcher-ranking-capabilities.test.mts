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
} from "../lib/launcher-ranking-capabilities.ts";

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
  assert.doesNotMatch(source, /auth|getUser|cookie|Supabase/i);
  assert.doesNotMatch(source, /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/);
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

test("page and endpoint consume the same public ranking helper", async () => {
  const [pageHelper, endpoint] = await Promise.all([
    readFile(join(root, "lib", "data", "week-detail.ts"), "utf8"),
    readFile(join(root, "app", "api", "launcher", "ranking-capabilities", "route.ts"), "utf8"),
  ]);

  assert.match(pageHelper, /resolvePublicRankingCapability/);
  assert.match(endpoint, /buildLauncherRankingResults/);
  assert.match(endpoint, /createSupabaseAdminClient/);
  assert.match(endpoint, /MAX_REQUEST_BYTES/);
  assert.doesNotMatch(endpoint, /Authorization|request\.cookies|rankingUrl/);
});
