import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildPublishedPackMap,
  buildLauncherWeekResults,
  LAUNCHER_WEEK_BATCH_LIMIT,
  resolvePublicWeekCapability,
  validateLauncherWeekRequest,
  validLauncherWeekDatabaseId,
} from "../lib/launcher-week-capabilities.ts";
import { deriveCurrentCompetitionWeekState } from "../lib/current-competition-week.ts";
import {
  deriveCanonicalWeekAuthority,
  getDerivedWeekStatus,
} from "../lib/week-status.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseWeek = {
  id: "week-a",
  week_number: 1,
  season_id: "season-a",
  game_id: "game-a",
  status: "active",
  public_start_at: "2026-08-01T00:00:00.000Z",
  public_freeze_at: "2026-08-05T00:00:00.000Z",
  final_deadline_at: "2026-08-07T00:00:00.000Z",
};
const now = new Date("2026-08-04T00:00:00.000Z");

test("week capability valida version, batch, IDs y requestKey unico", () => {
  assert.equal(validateLauncherWeekRequest({ version: 1, requests: [{ requestKey: "pack-a", weekId: "week-a" }] }).ok, true);
  assert.equal(validateLauncherWeekRequest({ version: 2, requests: [] }).ok, false);
  assert.equal(validateLauncherWeekRequest({ version: 1, requests: [{ requestKey: "bad key", weekId: "week-a" }] }).ok, false);
  assert.equal(validateLauncherWeekRequest({ version: 1, requests: [
    { requestKey: "same", weekId: "week-a" },
    { requestKey: "same", weekId: "week-b" },
  ] }).ok, false);
  assert.equal(validateLauncherWeekRequest({
    version: 1,
    requests: Array.from({ length: LAUNCHER_WEEK_BATCH_LIMIT + 1 }, (_, index) => ({ requestKey: `r-${index}`, weekId: `w-${index}` })),
  }).ok, false);
  assert.equal(validLauncherWeekDatabaseId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(validLauncherWeekDatabaseId("week-a"), false);
});

test("endpoint y vista web comparten la misma autoridad competitiva actual", () => {
  const season = { id: "season-a", status: "active" };
  const endpoint = resolvePublicWeekCapability(baseWeek, season, { now });
  const web = deriveCurrentCompetitionWeekState({ now, season, week: baseWeek });
  assert.equal(endpoint.publicState, "active");
  assert.equal(endpoint.publicState, web.publicState);
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, status: "closed", final_deadline_at: "2027-01-01T00:00:00Z" }, season, { now }).publicState, "active");
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, status: "published" }, season, { now }).publicState, "closed");
  assert.equal(resolvePublicWeekCapability(baseWeek, season, { hasOfficialResults: true, now }).publicState, "closed");
  assert.equal(resolvePublicWeekCapability(null, null).publicState, "unlinked");
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, game_id: null }, { id: "season-a", status: "active" }).publicState, "unlinked");
  assert.equal(resolvePublicWeekCapability(baseWeek, { id: "season-a", status: "draft" }, { now }).publicState, "inactive");
  assert.equal(resolvePublicWeekCapability(baseWeek, { id: "season-a", status: "completed" }, { now }).publicState, "closed");
});

test("matriz canónica impide drift entre autoridad, web y launcher", async (t) => {
  const cases = [
    { name: "scheduled", week: { ...baseWeek, public_start_at: "2026-08-05T00:00:00Z" }, expected: ["scheduled", "inactive", "week-inactive"] },
    { name: "active", week: baseWeek, expected: ["active", "active", "week-active"] },
    { name: "final-stretch", week: baseWeek, caseNow: new Date("2026-08-06T00:00:00Z"), expected: ["final_stretch", "active", "week-active"] },
    { name: "closed-deadline", week: baseWeek, caseNow: new Date("2026-08-07T00:00:00Z"), expected: ["closed", "closed", "week-closed"] },
    { name: "published", week: { ...baseWeek, status: "published" }, expected: ["published", "closed", "week-published"] },
    { name: "official-results", week: baseWeek, hasOfficialResults: true, expected: ["published", "closed", "official-results"] },
    { name: "season-draft", week: baseWeek, season: { id: "season-a", status: "draft" }, expected: ["draft", "inactive", "season-inactive"] },
    { name: "season-completed", week: baseWeek, season: { id: "season-a", status: "completed" }, expected: ["closed", "closed", "season-completed"] },
    { name: "calendar-incomplete", week: { ...baseWeek, final_deadline_at: null }, expected: ["scheduled", "inactive", "calendar-incomplete"] },
    { name: "raw-closed-open-calendar", week: { ...baseWeek, status: "closed" }, expected: ["active", "active", "week-active"] },
    { name: "raw-active-expired", week: baseWeek, caseNow: new Date("2026-08-08T00:00:00Z"), expected: ["closed", "closed", "week-closed"] },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const season = fixture.season || { id: "season-a", status: "active" };
      const caseNow = fixture.caseNow || now;
      const canonical = deriveCanonicalWeekAuthority({
        hasOfficialResults: fixture.hasOfficialResults,
        now: caseNow,
        season,
        week: fixture.week,
      });
      const web = deriveCurrentCompetitionWeekState({
        hasOfficialResults: fixture.hasOfficialResults,
        now: caseNow,
        season,
        week: fixture.week,
      });
      const launcher = resolvePublicWeekCapability(fixture.week, season, {
        hasOfficialResults: fixture.hasOfficialResults,
        now: caseNow,
      });
      assert.deepEqual(
        [canonical.derivedStatus, canonical.publicState, canonical.reason],
        fixture.expected,
      );
      assert.deepEqual(web, canonical);
      assert.deepEqual(launcher, canonical);
      if (season.status === "active") {
        assert.equal(
          getDerivedWeekStatus(fixture.week, caseNow, fixture.hasOfficialResults),
          canonical.derivedStatus,
        );
      }
    });
  }
});

test("batch conserva correlacion, fechas publicas y no contiene informacion personal", () => {
  const results = buildLauncherWeekResults({
    requests: [
      { requestKey: "a", weekId: "week-a" },
      { requestKey: "duplicate", weekId: "week-a" },
      { requestKey: "missing", weekId: "week-missing" },
    ],
    weeks: [baseWeek],
    seasons: [{ id: "season-a", status: "active" }],
    now,
  });
  assert.equal(results[0].publicState, "active");
  assert.equal(results[0].canPlayCompetition, true);
  assert.equal(results[0].publicStartAt, baseWeek.public_start_at);
  assert.equal(results[0].seasonStatus, "active");
  assert.equal(results[0].publishedPackId, null);
  assert.equal(results[1].weekId, "week-a");
  assert.equal(results[2].publicState, "unlinked");
  assert.equal(results[2].reason, "not-found");
  assert.doesNotMatch(JSON.stringify(results), /user|email|membership|token|score/i);
});

test("publishedPackId es aditivo, trivalente y usa la misma frontera pública", () => {
  const published = new Map([["week-a", "space-invaders-s1-w1-r2"]]);
  const current = buildLauncherWeekResults({
    requests: [{ requestKey: "current", weekId: "week-a" }],
    weeks: [baseWeek],
    seasons: [{ id: "season-a", status: "active" }],
    publishedPackIds: published,
    currentActiveWeekNumbers: new Map([["season-a", 1]]),
    now,
  });
  assert.equal(current[0].publishedPackId, "space-invaders-s1-w1-r2");

  const knownWithoutPack = buildLauncherWeekResults({
    requests: [{ requestKey: "none", weekId: "week-a" }],
    weeks: [baseWeek],
    seasons: [{ id: "season-a", status: "active" }],
    publishedPackIds: new Map(),
    currentActiveWeekNumbers: new Map([["season-a", 1]]),
    now,
  });
  assert.equal(knownWithoutPack[0].publishedPackId, null);

  const hidden = buildLauncherWeekResults({
    requests: [{ requestKey: "future", weekId: "week-future" }],
    weeks: [{ ...baseWeek, id: "week-future", week_number: 2, public_start_at: "2026-08-03T00:00:00Z" }],
    seasons: [{ id: "season-a", status: "active" }],
    publishedPackIds: new Map([["week-future", "must-not-leak"]]),
    currentActiveWeekNumbers: new Map([["season-a", 1]]),
    now,
  });
  assert.equal(hidden[0].publishedPackId, null);
});

test("mapa de packs publicados rechaza filas inválidas, duplicadas o fuera de visibilidad", () => {
  const revealable = new Set(["week-a"]);
  assert.equal(buildPublishedPackMap([{ week_id: "week-a", pack_id: "pack-r2" }], revealable)?.get("week-a"), "pack-r2");
  assert.equal(buildPublishedPackMap([{ week_id: "week-private", pack_id: "private-pack" }], revealable), null);
  assert.equal(buildPublishedPackMap([{ week_id: "week-a", pack_id: "bad pack" }], revealable), null);
  assert.equal(buildPublishedPackMap([
    { week_id: "week-a", pack_id: "pack-r2" },
    { week_id: "week-a", pack_id: "pack-r3" },
  ], revealable), null);
});

test("endpoint usa autoridad compartida y weekly_results batch, es publico y no-store", async () => {
  const route = await readFile(join(root, "app", "api", "launcher", "week-capabilities", "route.ts"), "utf8");
  assert.match(route, /from\("weekly_results"\)\.select\("week_id"\)\.in\("week_id", weekIds\)/);
  assert.match(route, /officialResultWeekIds/);
  assert.match(route, /from\("launcher_packs"\)\.select\("week_id,pack_id"\)[\s\S]*\.eq\("status", "published"\)/);
  assert.match(route, /WEEK_PACK_QUERY_FAILED[\s\S]*503/);
  assert.match(route, /launcherWeekIsPubliclyRevealable/);
  assert.match(route, /getLauncherDeploymentHeaders/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /MAX_REQUEST_BYTES/);
  assert.match(route, /validateLauncherWeekRequest/);
  assert.match(route, /createSupabaseAdminClient/);
  assert.doesNotMatch(route, /Authorization|request\.cookies|getUser|season_memberships|scores/);
});

test("la escritura directa de status está deprecada y PATCH/cron usan reconciliación canónica", async () => {
  const [directStatusRoute, canonicalWeekRoute, scheduleRoute] = await Promise.all([
    readFile(join(root, "app", "api", "admin", "weeks", "[weekId]", "status", "route.ts"), "utf8"),
    readFile(join(root, "app", "api", "admin", "weeks", "[weekId]", "route.ts"), "utf8"),
    readFile(join(root, "app", "api", "cron", "process-schedule", "route.ts"), "utf8"),
  ]);
  assert.match(directStatusRoute, /WEEK_STATUS_DIRECT_WRITE_DEPRECATED/);
  assert.match(directStatusRoute, /status:\s*410/);
  assert.doesNotMatch(directStatusRoute, /\.from\("weeks"\)|\.update\(/);
  assert.match(canonicalWeekRoute, /existingWeek\.status === "published"[\s\S]*?\? "published"/);
  assert.match(canonicalWeekRoute, /reconcileWeek\(auth\.supabase, data\.id\)/);
  assert.match(scheduleRoute, /reconcileWeek\(supabase, week\.id, now\)/);
});

test("batch cierra solo las weeks con resultados oficiales", () => {
  const results = buildLauncherWeekResults({
    requests: [
      { requestKey: "active", weekId: "week-a" },
      { requestKey: "results", weekId: "week-b" },
    ],
    weeks: [baseWeek, { ...baseWeek, id: "week-b" }],
    seasons: [{ id: "season-a", status: "active" }],
    officialResultWeekIds: new Set(["week-b"]),
    now,
  });
  assert.equal(results[0].publicState, "active");
  assert.equal(results[1].publicState, "closed");
  assert.equal(results[1].reason, "official-results");
});
