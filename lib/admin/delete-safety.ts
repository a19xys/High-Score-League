import type { SupabaseClient } from "@supabase/supabase-js";
import { getSynchronizedSeasonStatus, getSynchronizedWeekStatus } from "@/lib/week-status";
import type { SeasonRow, WeekRow } from "@/types/supabase";

const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";
const seasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";

export type DeleteEligibility = {
  deletable: boolean;
  code: string;
  reason: string;
};

export type WeekDeleteEligibility = DeleteEligibility & {
  week: WeekRow | null;
  season: SeasonRow | null;
  submissionCount: number;
  weeklyResultCount: number;
};

export type SeasonDeleteEligibility = DeleteEligibility & {
  season: SeasonRow | null;
  weekIds: string[];
  submissionCount: number;
  weeklyResultCount: number;
};

function notDeletable(code: string, reason: string) {
  return { deletable: false, code, reason };
}

export async function getWeekDeleteEligibility(
  supabase: SupabaseClient,
  weekId: string,
): Promise<WeekDeleteEligibility> {
  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select(weekColumns)
    .eq("id", weekId)
    .maybeSingle<WeekRow>();

  if (weekError || !week) {
    return {
      ...notDeletable("WEEK_NOT_FOUND", "Semana no encontrada."),
      week: null,
      season: null,
      submissionCount: 0,
      weeklyResultCount: 0,
    };
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select(seasonColumns)
    .eq("id", week.season_id)
    .maybeSingle<SeasonRow>();

  if (seasonError || !season) {
    return {
      ...notDeletable("SEASON_NOT_FOUND", "Temporada no encontrada."),
      week,
      season: null,
      submissionCount: 0,
      weeklyResultCount: 0,
    };
  }

  const [submissions, weeklyResults] = await Promise.all([
    supabase.from("submissions").select("id").eq("week_id", week.id),
    supabase.from("weekly_results").select("id").eq("week_id", week.id),
  ]);

  const submissionCount = (submissions.data ?? []).length;
  const weeklyResultCount = (weeklyResults.data ?? []).length;
  const base = { week, season, submissionCount, weeklyResultCount };

  if (submissions.error || weeklyResults.error) {
    return {
      ...notDeletable("WEEK_DELETE_CHECK_FAILED", "No se pudo comprobar si la semana es borrable."),
      ...base,
    };
  }

  if (getSynchronizedSeasonStatus(season) === "completed") {
    return {
      ...notDeletable(
        "WEEK_NOT_DELETABLE",
        "Solo se pueden borrar semanas inactivas sin submissions ni resultados.",
      ),
      ...base,
    };
  }

  if (submissionCount > 0 || weeklyResultCount > 0) {
    return {
      ...notDeletable(
        "WEEK_NOT_DELETABLE",
        "Solo se pueden borrar semanas inactivas sin submissions ni resultados.",
      ),
      ...base,
    };
  }

  if (
    week.status === "closed" ||
    week.status === "published" ||
    getSynchronizedWeekStatus(week) !== "draft"
  ) {
    return {
      ...notDeletable(
        "WEEK_NOT_DELETABLE",
        "Solo se pueden borrar semanas inactivas sin submissions ni resultados.",
      ),
      ...base,
    };
  }

  return {
    deletable: true,
    code: "WEEK_DELETABLE",
    reason: "Semana inactiva sin submissions ni resultados.",
    ...base,
  };
}

export async function getSeasonDeleteEligibility(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<SeasonDeleteEligibility> {
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select(seasonColumns)
    .or(`id.eq.${seasonId},slug.eq.${seasonId}`)
    .maybeSingle<SeasonRow>();

  if (seasonError || !season) {
    return {
      ...notDeletable("SEASON_NOT_FOUND", "Temporada no encontrada."),
      season: null,
      weekIds: [],
      submissionCount: 0,
      weeklyResultCount: 0,
    };
  }

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id")
    .eq("season_id", season.id);

  const weekIds = ((weeks ?? []) as Array<{ id: string }>).map((week) => week.id);
  const [submissions, weeklyResults] = await Promise.all([
    weekIds.length > 0
      ? supabase.from("submissions").select("id").in("week_id", weekIds)
      : Promise.resolve({ data: [], error: null }),
    weekIds.length > 0
      ? supabase.from("weekly_results").select("id").in("week_id", weekIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const submissionCount = (submissions.data ?? []).length;
  const weeklyResultCount = (weeklyResults.data ?? []).length;
  const base = { season, weekIds, submissionCount, weeklyResultCount };

  if (weeksError || submissions.error || weeklyResults.error) {
    return {
      ...notDeletable(
        "SEASON_DELETE_CHECK_FAILED",
        "No se pudo comprobar si la temporada es borrable.",
      ),
      ...base,
    };
  }

  if (
    season.status === "completed" ||
    getSynchronizedSeasonStatus(season) !== "draft"
  ) {
    return {
      ...notDeletable(
        "SEASON_NOT_DELETABLE",
        "Solo se pueden borrar temporadas inactivas sin submissions ni resultados.",
      ),
      ...base,
    };
  }

  if (submissionCount > 0 || weeklyResultCount > 0) {
    return {
      ...notDeletable(
        "SEASON_NOT_DELETABLE",
        "Solo se pueden borrar temporadas inactivas sin submissions ni resultados.",
      ),
      ...base,
    };
  }

  return {
    deletable: true,
    code: "SEASON_DELETABLE",
    reason: "Temporada inactiva sin submissions ni resultados.",
    ...base,
  };
}
