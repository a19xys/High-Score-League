import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildLauncherWeekResults,
  LAUNCHER_WEEK_BATCH_LIMIT,
  resolvePublicWeekCapability,
  validateLauncherWeekRequest,
  validLauncherWeekDatabaseId,
} from "../lib/launcher-week-capabilities.ts";
import { deriveCurrentCompetitionWeekState } from "../lib/current-competition-week.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseWeek = {
  id: "week-a",
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
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, status: "closed", final_deadline_at: "2027-01-01T00:00:00Z" }, season, { now }).publicState, "closed");
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, status: "published" }, season, { now }).publicState, "closed");
  assert.equal(resolvePublicWeekCapability(baseWeek, season, { hasOfficialResults: true, now }).publicState, "closed");
  assert.equal(resolvePublicWeekCapability(null, null).publicState, "unlinked");
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, game_id: null }, { id: "season-a", status: "active" }).publicState, "unlinked");
  assert.equal(resolvePublicWeekCapability(baseWeek, { id: "season-a", status: "draft" }, { now }).publicState, "inactive");
  assert.equal(resolvePublicWeekCapability(baseWeek, { id: "season-a", status: "completed" }, { now }).publicState, "closed");
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
  assert.equal(results[1].weekId, "week-a");
  assert.equal(results[2].publicState, "unlinked");
  assert.equal(results[2].reason, "not-found");
  assert.doesNotMatch(JSON.stringify(results), /user|email|membership|token|score/i);
});

test("endpoint usa autoridad compartida y weekly_results batch, es publico y no-store", async () => {
  const route = await readFile(join(root, "app", "api", "launcher", "week-capabilities", "route.ts"), "utf8");
  assert.match(route, /from\("weekly_results"\)\.select\("week_id"\)\.in\("week_id", weekIds\)/);
  assert.match(route, /officialResultWeekIds/);
  assert.match(route, /getLauncherDeploymentHeaders/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /MAX_REQUEST_BYTES/);
  assert.match(route, /validateLauncherWeekRequest/);
  assert.match(route, /createSupabaseAdminClient/);
  assert.doesNotMatch(route, /Authorization|request\.cookies|getUser|season_memberships|scores/);
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
