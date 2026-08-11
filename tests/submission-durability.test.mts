import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deriveSubmissionWindowAt,
  SUBMISSION_FUTURE_SKEW_MS,
} from "../lib/submission-window.ts";

const window = {
  public_start_at: "2026-08-11T20:00:00.000Z",
  public_freeze_at: "2026-08-11T22:30:00.000Z",
  final_deadline_at: "2026-08-11T23:00:00.000Z",
};
const afterDeadline = "2026-08-11T23:10:00.000Z";

test("detectedAt alone selects active, final stretch, before-open and closed", () => {
  assert.deepEqual(
    deriveSubmissionWindowAt(window, "2026-08-11T22:00:00.000Z", { now: afterDeadline }),
    { accepted: true, code: null, forceHidden: false, state: "active" },
  );
  assert.deepEqual(
    deriveSubmissionWindowAt(window, "2026-08-11T22:45:00.000Z", { now: afterDeadline }),
    { accepted: true, code: null, forceHidden: true, state: "final-stretch" },
  );
  assert.equal(
    deriveSubmissionWindowAt(window, "2026-08-11T19:59:59.999Z", { now: afterDeadline }).code,
    "WEEK_NOT_OPEN_AT_DETECTION",
  );
  assert.equal(
    deriveSubmissionWindowAt(window, "2026-08-11T23:05:00.000Z", { now: afterDeadline }).code,
    "WEEK_CLOSED_AT_DETECTION",
  );
});

test("freeze is optional, required dates are strict and there is no maximum event age", () => {
  const withoutFreeze = { ...window, public_freeze_at: null };
  assert.equal(
    deriveSubmissionWindowAt(withoutFreeze, "2026-08-11T22:59:59.999Z", { now: "2036-01-01T00:00:00Z" }).state,
    "active",
  );
  assert.equal(
    deriveSubmissionWindowAt({ ...window, public_start_at: null }, window.public_start_at, { now: afterDeadline }).code,
    "WEEK_WINDOW_UNAVAILABLE",
  );
  assert.equal(
    deriveSubmissionWindowAt({ ...window, final_deadline_at: null }, window.public_start_at, { now: afterDeadline }).code,
    "WEEK_WINDOW_UNAVAILABLE",
  );
});

test("future skew is exactly ten minutes and injectable", () => {
  assert.equal(SUBMISSION_FUTURE_SKEW_MS, 10 * 60 * 1000);
  const futureWindow = {
    public_start_at: "2026-08-11T19:00:00.000Z",
    public_freeze_at: null,
    final_deadline_at: "2026-08-12T00:00:00.000Z",
  };
  assert.equal(
    deriveSubmissionWindowAt(futureWindow, "2026-08-11T20:10:00.000Z", { now: "2026-08-11T20:00:00.000Z" }).accepted,
    true,
  );
  assert.equal(
    deriveSubmissionWindowAt(futureWindow, "2026-08-11T20:10:00.001Z", { now: "2026-08-11T20:00:00.000Z" }).code,
    "DETECTED_AT_IN_FUTURE",
  );
});

test("ingest checks player-scoped duplicates before mutable week policy", async () => {
  const route = await readFile(join(process.cwd(), "app/api/submissions/ingest/route.ts"), "utf8");
  const duplicateLookup = route.indexOf('.from("submissions")');
  const weekLookup = route.indexOf('.from("weeks")');
  const membershipLookup = route.indexOf('.from("season_memberships")');
  const historicalWindow = route.indexOf("deriveSubmissionWindowAt(week, input.detectedAt)");
  const insert = route.indexOf('.from("submissions")', duplicateLookup + 1);

  assert.ok(duplicateLookup > 0 && duplicateLookup < weekLookup);
  assert.ok(weekLookup < membershipLookup && membershipLookup < historicalWindow && historicalWindow < insert);
  assert.match(route, /\.eq\("player_id", userData\.user\.id\)[\s\S]*\.eq\("duplicate_key", input\.duplicateKey\)/);
  assert.match(route, /canonicalEventMatches[\s\S]*week_id[\s\S]*score[\s\S]*detected_at/);
  assert.match(route, /insertError\.code === "23505"[\s\S]*canonicalEventMatches/);
  assert.doesNotMatch(route, /getSynchronizedWeekStatus/);
  for (const code of [
    "WEEK_NOT_FOUND", "WEEK_GAME_NOT_ASSIGNED", "NOT_SEASON_MEMBER",
    "WEEK_WINDOW_UNAVAILABLE", "WEEK_NOT_OPEN_AT_DETECTION",
    "WEEK_CLOSED_AT_DETECTION", "DETECTED_AT_IN_FUTURE",
    "DUPLICATE_KEY_CONFLICT", "SUBMISSION_POLICY_REJECTED",
  ]) assert.match(route, new RegExp(code));
});

test("migration scopes idempotency by player and mirrors detectedAt without current time/status", async () => {
  const sql = await readFile(join(process.cwd(), "supabase/migrations/0026_submission_detected_at_window.sql"), "utf8");
  assert.match(sql, /drop index if exists public\.submissions_duplicate_key_unique_idx/i);
  assert.match(sql, /unique index submissions_player_duplicate_key_unique_idx[\s\S]*\(player_id, duplicate_key\)[\s\S]*duplicate_key is not null/i);
  assert.match(sql, /detected_at is not null/i);
  assert.match(sql, /detected_at >= w\.public_start_at/i);
  assert.match(sql, /detected_at < w\.final_deadline_at/i);
  assert.match(sql, /w\.public_freeze_at is null[\s\S]*detected_at < w\.public_freeze_at[\s\S]*is_hidden = true/i);
  assert.match(sql, /sm\.player_id = auth\.uid\(\)[\s\S]*sm\.status = 'active'/i);
  assert.doesNotMatch(sql, /\bnow\s*\(/i);
  assert.doesNotMatch(sql, /w\.status/i);
  assert.doesNotMatch(sql, /coalesce/i);
});

test("rejected stays outside the launcher Activity projection", async () => {
  const [launcher, panel] = await Promise.all([
    readFile(join(process.cwd(), "local/hsl-local-app/gui/launcher-service.js"), "utf8"),
    readFile(join(process.cwd(), "local/hsl-local-app/gui/renderer/components/queue-panel.js"), "utf8"),
  ]);
  const getQueueState = launcher.slice(
    launcher.indexOf("async function getQueueState"),
    launcher.indexOf("function getEmptyQueueState"),
  );
  assert.doesNotMatch(getQueueState, /rejected/i);
  assert.doesNotMatch(panel, /rejected|rechazad/i);
});

test("post-MAME no afirma que un terminal rejected se haya enviado", async () => {
  const launcher = await readFile(join(process.cwd(), "local/hsl-local-app/gui/launcher-service.js"), "utf8");
  const playCompetition = launcher.slice(
    launcher.indexOf("async function playCompetition"),
    launcher.indexOf("async function playPractice"),
  );
  assert.doesNotMatch(playCompetition, /puntuaci[oó]n enviada|enviada correctamente/i);
  assert.match(playCompetition, /captura\(s\) nueva\(s\) movida\(s\) a la cola/);
});
