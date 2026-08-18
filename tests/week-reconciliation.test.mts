import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileWeek } from "../lib/admin/reconcile-week.ts";
import { resolvePublicWeekCapability } from "../lib/launcher-week-capabilities.ts";

function createReconciliationDatabase() {
  const log: string[] = [];
  const state = {
    week: {
      id: "week-a",
      season_id: "season-a",
      game_id: "game-a",
      week_number: 1,
      status: "published",
      public_start_at: "2026-08-01T00:00:00.000Z",
      public_freeze_at: "2026-08-05T00:00:00.000Z",
      final_deadline_at: "2026-08-07T00:00:00.000Z",
      reveal_at: null,
      rules_summary: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    season: {
      id: "season-a",
      name: "Season A",
      slug: "season-a",
      version: 1,
      status: "active",
      starts_at: "2026-07-01T00:00:00.000Z",
      ends_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    results: [{ id: "result-old" }],
    submissions: [{
      id: "submission-a",
      is_hidden: true,
      detected_at: "2026-08-04T00:00:00.000Z",
      submitted_at: "2026-08-04T00:10:00.000Z",
    }],
  };

  class Query {
    table: string;
    operation = "select";
    values: Record<string, unknown> | null = null;
    ids: string[] = [];

    constructor(table: string) { this.table = table; }
    select() { return this; }
    eq() { return this; }
    update(values: Record<string, unknown>) { this.operation = "update"; this.values = values; return this; }
    delete() { this.operation = "delete"; return this; }
    in(_column: string, ids: string[]) { this.ids = ids; return this; }
    async maybeSingle() {
      if (this.table === "weeks") {
        if (this.operation === "update") {
          Object.assign(state.week, this.values);
          log.push(`weeks:update:${state.week.status}`);
        }
        return { data: { ...state.week }, error: null };
      }
      if (this.table === "seasons") return { data: { ...state.season }, error: null };
      return { data: null, error: null };
    }
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      try {
        if (this.table === "weekly_results") {
          if (this.operation === "delete") {
            log.push("weekly_results:delete");
            state.results = [];
          }
          resolve({ data: this.operation === "select" ? [...state.results] : null, error: null });
          return;
        }
        if (this.table === "submissions") {
          if (this.operation === "update") {
            const hidden = this.values?.is_hidden === true;
            for (const submission of state.submissions) {
              if (this.ids.includes(submission.id)) submission.is_hidden = hidden;
            }
            log.push(`submissions:update:${hidden}`);
          }
          resolve({ data: this.operation === "select" ? state.submissions.map((item) => ({ ...item })) : null, error: null });
          return;
        }
        resolve({ data: null, error: null });
      } catch (error) {
        reject(error);
      }
    }
  }

  return {
    client: { from: (table: string) => new Query(table) } as unknown as SupabaseClient,
    log,
    state,
  };
}

test("reapertura soportada retira resultados, reconcilia visibilidad y termina ACTIVE", async () => {
  const database = createReconciliationDatabase();
  const now = new Date("2026-08-04T00:00:00.000Z");
  const result = await reconcileWeek(database.client, "week-a", now);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.reopened, true);
  assert.equal(result.summary.weeklyResultsDeleted, 1);
  assert.equal(result.summary.nextStatus, "active");
  assert.equal(database.state.results.length, 0);
  assert.equal(database.state.week.status, "active");
  assert.equal(database.state.submissions[0].is_hidden, false);
  assert.ok(database.log.indexOf("weekly_results:delete") < database.log.indexOf("weeks:update:active"));

  const capability = resolvePublicWeekCapability(
    result.week,
    result.season,
    { hasOfficialResults: database.state.results.length > 0, now },
  );
  assert.equal(capability.publicState, "active");
  assert.equal(capability.reason, "week-active");
});

test("reconciliación respeta temporada completada y conserva resultados como terminales", async () => {
  const database = createReconciliationDatabase();
  database.state.season.status = "completed";
  database.state.week.status = "active";
  const now = new Date("2026-08-04T00:00:00.000Z");
  const result = await reconcileWeek(database.client, "week-a", now);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.reopened, false);
  assert.equal(result.summary.weeklyResultsDeleted, 0);
  assert.equal(result.summary.nextStatus, "published");
  assert.equal(database.state.results.length, 1);

  const capability = resolvePublicWeekCapability(
    result.week,
    result.season,
    { hasOfficialResults: true, now },
  );
  assert.equal(capability.publicState, "closed");
  assert.equal(capability.reason, "official-results");
});
