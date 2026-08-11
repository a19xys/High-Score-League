import test from "node:test";
import assert from "node:assert/strict";
import { deriveCurrentCompetitionWeekState } from "../lib/current-competition-week.ts";

const activeSeason = { status: "active" };
const activeWeek = {
  status: "active",
  public_start_at: "2026-08-01T00:00:00.000Z",
  public_freeze_at: "2026-08-05T00:00:00.000Z",
  final_deadline_at: "2026-08-07T00:00:00.000Z",
};

function derive(overrides = {}, options = {}) {
  return deriveCurrentCompetitionWeekState({
    now: new Date("2026-08-04T00:00:00.000Z"),
    season: activeSeason,
    week: { ...activeWeek, ...overrides },
    ...options,
  });
}

test("la autoridad actual aplica primero cierres terminales", () => {
  assert.equal(derive({}, { hasOfficialResults: true }).publicState, "closed");
  assert.equal(derive({ status: "published" }).publicState, "closed");
  assert.equal(derive({ status: "closed", final_deadline_at: "2027-01-01T00:00:00Z" }).publicState, "closed");
  assert.equal(derive({}, { season: { status: "completed" } }).publicState, "closed");
});

test("la autoridad actual respeta temporada y calendario", () => {
  assert.equal(derive({}, { season: { status: "draft" } }).publicState, "inactive");
  assert.equal(derive({ public_start_at: "2026-08-05T00:00:00Z" }).publicState, "inactive");
  assert.equal(derive().publicState, "active");
  assert.equal(derive({}, { now: new Date("2026-08-06T00:00:00Z") }).derivedStatus, "final_stretch");
  assert.equal(derive({}, { now: new Date("2026-08-07T00:00:00Z") }).publicState, "closed");
  assert.equal(derive({ status: "active" }, { now: new Date("2026-08-08T00:00:00Z") }).publicState, "closed");
});

test("un calendario insuficiente se mantiene seguro y no activo", () => {
  const state = derive({ public_start_at: null, final_deadline_at: null });
  assert.equal(state.publicState, "inactive");
  assert.equal(state.reason, "calendar-incomplete");
  assert.equal(state.canPlayCompetition, false);
});
