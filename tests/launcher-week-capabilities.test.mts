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
import { getDerivedWeekStatus } from "../lib/week-status.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseWeek = {
  id: "week-a",
  season_id: "season-a",
  game_id: "game-a",
  status: "active",
  public_start_at: "2026-08-01T00:00:00.000Z",
  public_freeze_at: "2026-08-05T00:00:00.000Z",
  final_deadline_at: "2026-08-07T00:00:00.000Z",
  derivedStatus: "active",
};

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

test("draft/scheduled son INACTIVA, active/final stretch ACTIVA y closed/published CERRADA", () => {
  for (const derivedStatus of ["draft", "scheduled"]) {
    assert.equal(resolvePublicWeekCapability({ ...baseWeek, derivedStatus }, { id: "season-a", status: "active" }).publicState, "inactive");
  }
  for (const derivedStatus of ["active", "final_stretch"]) {
    const result = resolvePublicWeekCapability({ ...baseWeek, derivedStatus }, { id: "season-a", status: "active" });
    assert.equal(result.publicState, "active");
  }
  for (const derivedStatus of ["closed", "published"]) {
    assert.equal(resolvePublicWeekCapability({ ...baseWeek, derivedStatus }, { id: "season-a", status: "active" }).publicState, "closed");
  }
  assert.equal(resolvePublicWeekCapability(null, null).publicState, "unlinked");
  assert.equal(resolvePublicWeekCapability({ ...baseWeek, game_id: null }, { id: "season-a", status: "active" }).publicState, "unlinked");
  assert.equal(resolvePublicWeekCapability(baseWeek, { id: "season-a", status: "draft" }).publicState, "inactive");
  assert.equal(resolvePublicWeekCapability(baseWeek, { id: "season-a", status: "completed" }).publicState, "closed");
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

test("endpoint usa getDerivedWeekStatus, es publico, no-store y comparte deployment headers", async () => {
  const route = await readFile(join(root, "app", "api", "launcher", "week-capabilities", "route.ts"), "utf8");
  assert.match(route, /getDerivedWeekStatus\(week, now\)/);
  assert.match(route, /getLauncherDeploymentHeaders/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /MAX_REQUEST_BYTES/);
  assert.match(route, /validateLauncherWeekRequest/);
  assert.match(route, /createSupabaseAdminClient/);
  assert.doesNotMatch(route, /Authorization|request\.cookies|getUser|season_memberships|scores/);

  assert.equal(getDerivedWeekStatus({
    status: "draft",
    public_start_at: "2026-08-02T00:00:00Z",
    public_freeze_at: null,
    final_deadline_at: "2026-08-03T00:00:00Z",
  }, new Date("2026-08-01T00:00:00Z")), "scheduled");
});
