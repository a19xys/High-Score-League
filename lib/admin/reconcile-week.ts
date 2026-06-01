import type { SupabaseClient } from "@supabase/supabase-js";
import { getSynchronizedSeasonStatus, getSynchronizedWeekStatus } from "@/lib/week-status";
import type { WeekStatus } from "@/types";
import type { SeasonRow, WeekRow } from "@/types/supabase";

const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";
const seasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";

type SubmissionVisibilityRow = {
  id: string;
  is_hidden: boolean;
  detected_at: string | null;
  submitted_at: string;
};

export type ReconcileWeekSummary = {
  weekId: string;
  seasonId: string;
  previousStatus: WeekStatus;
  nextStatus: WeekStatus;
  statusUpdated: boolean;
  officialResultsBefore: number;
  weeklyResultsDeleted: number;
  reopened: boolean;
  submissionsChecked: number;
  submissionsMadeVisible: number;
  submissionsMadeHidden: number;
};

export type ReconcileWeekResult =
  | { ok: true; week: WeekRow; season: SeasonRow; summary: ReconcileWeekSummary }
  | { ok: false; status: number; code?: string; error: string };

function parseTime(value: string | null) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function isCompletedSeason(season: SeasonRow) {
  return (
    season.status === "completed" ||
    getSynchronizedSeasonStatus(season) === "completed"
  );
}

function resolveDateDrivenStatus(week: WeekRow, now: Date) {
  return getSynchronizedWeekStatus(
    {
      ...week,
      status: "draft",
    },
    now,
    false,
  );
}

function resolveSubmissionHiddenState(
  submission: SubmissionVisibilityRow,
  week: WeekRow,
  revealAll = false,
) {
  if (revealAll) {
    return false;
  }

  const effectiveTime =
    parseTime(submission.detected_at) ?? parseTime(submission.submitted_at);
  const startsAt = parseTime(week.public_start_at);
  const finalStretchAt = parseTime(week.public_freeze_at);
  const closesAt = parseTime(week.final_deadline_at);

  if (effectiveTime === null) {
    return submission.is_hidden;
  }

  if (
    (startsAt !== null && effectiveTime < startsAt) ||
    (closesAt !== null && effectiveTime >= closesAt)
  ) {
    return true;
  }

  if (
    finalStretchAt !== null &&
    effectiveTime >= finalStretchAt &&
    (closesAt === null || effectiveTime < closesAt)
  ) {
    return true;
  }

  return false;
}

async function updateSubmissionVisibility(
  supabase: SupabaseClient,
  week: WeekRow,
  revealAll = false,
) {
  const { data, error } = await supabase
    .from("submissions")
    .select("id,is_hidden,detected_at,submitted_at")
    .eq("week_id", week.id)
    .eq("is_valid", true);

  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: "No se pudieron leer submissions para reconciliar visibilidad.",
    };
  }

  const submissions = (data ?? []) as SubmissionVisibilityRow[];
  const makeVisible: string[] = [];
  const makeHidden: string[] = [];

  for (const submission of submissions) {
    const nextHidden = resolveSubmissionHiddenState(submission, week, revealAll);

    if (nextHidden === submission.is_hidden) {
      continue;
    }

    if (nextHidden) {
      makeHidden.push(submission.id);
    } else {
      makeVisible.push(submission.id);
    }
  }

  if (makeVisible.length > 0) {
    const { error: visibleError } = await supabase
      .from("submissions")
      .update({ is_hidden: false })
      .in("id", makeVisible);

    if (visibleError) {
      return {
        ok: false as const,
        status: 500,
        error: "No se pudieron hacer visibles las submissions reconciliadas.",
      };
    }
  }

  if (makeHidden.length > 0) {
    const { error: hiddenError } = await supabase
      .from("submissions")
      .update({ is_hidden: true })
      .in("id", makeHidden);

    if (hiddenError) {
      return {
        ok: false as const,
        status: 500,
        error: "No se pudieron ocultar las submissions reconciliadas.",
      };
    }
  }

  return {
    ok: true as const,
    checked: submissions.length,
    madeVisible: makeVisible.length,
    madeHidden: makeHidden.length,
  };
}

export async function assertSeasonCanReceiveWeekChanges(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<{ ok: true; season: SeasonRow } | { ok: false; status: number; code: string; error: string }> {
  const { data: season, error } = await supabase
    .from("seasons")
    .select(seasonColumns)
    .eq("id", seasonId)
    .maybeSingle<SeasonRow>();

  if (error) {
    return {
      ok: false,
      status: 500,
      code: "SEASON_READ_FAILED",
      error: "No se pudo comprobar la temporada.",
    };
  }

  if (!season) {
    return {
      ok: false,
      status: 404,
      code: "SEASON_NOT_FOUND",
      error: "Temporada no encontrada.",
    };
  }

  if (isCompletedSeason(season)) {
    return {
      ok: false,
      status: 409,
      code: "SEASON_COMPLETED_LOCKED",
      error: "No se pueden modificar semanas de una temporada completada.",
    };
  }

  return { ok: true, season };
}

export async function assertWeekSeasonCanBeChanged(
  supabase: SupabaseClient,
  weekId: string,
) {
  const { data: week, error } = await supabase
    .from("weeks")
    .select("id,season_id")
    .eq("id", weekId)
    .maybeSingle<Pick<WeekRow, "id" | "season_id">>();

  if (error) {
    return {
      ok: false as const,
      status: 500,
      code: "WEEK_READ_FAILED",
      error: "No se pudo comprobar la semana.",
    };
  }

  if (!week) {
    return {
      ok: false as const,
      status: 404,
      code: "WEEK_NOT_FOUND",
      error: "Semana no encontrada.",
    };
  }

  return assertSeasonCanReceiveWeekChanges(supabase, week.season_id);
}

export async function reconcileWeek(
  supabase: SupabaseClient,
  weekId: string,
  now = new Date(),
): Promise<ReconcileWeekResult> {
  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select(weekColumns)
    .eq("id", weekId)
    .maybeSingle<WeekRow>();

  if (weekError) {
    return { ok: false, status: 500, error: "No se pudo leer la semana." };
  }

  if (!week) {
    return { ok: false, status: 404, error: "Semana no encontrada." };
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select(seasonColumns)
    .eq("id", week.season_id)
    .maybeSingle<SeasonRow>();

  if (seasonError) {
    return { ok: false, status: 500, error: "No se pudo leer la temporada." };
  }

  if (!season) {
    return { ok: false, status: 404, error: "Temporada no encontrada." };
  }

  const { data: officialResults, error: resultsError } = await supabase
    .from("weekly_results")
    .select("id")
    .eq("week_id", week.id);

  if (resultsError) {
    return {
      ok: false,
      status: 500,
      error: "No se pudo comprobar si hay resultados oficiales.",
    };
  }

  const officialResultCount = (officialResults ?? []).length;
  const dateDrivenStatus = resolveDateDrivenStatus(week, now);
  const reopened =
    (officialResultCount > 0 || week.status === "published") &&
    dateDrivenStatus !== "closed";
  let weeklyResultsDeleted = 0;

  if (reopened && officialResultCount > 0) {
    const { error: deleteError } = await supabase
      .from("weekly_results")
      .delete()
      .eq("week_id", week.id);

    if (deleteError) {
      return {
        ok: false,
        status: 500,
        error: "No se pudieron retirar resultados oficiales al reabrir la semana.",
      };
    }

    weeklyResultsDeleted = officialResultCount;
  }

  const hasOfficialAfterReopen = !reopened && officialResultCount > 0;
  const nextStatus: WeekStatus =
    dateDrivenStatus === "closed"
      ? hasOfficialAfterReopen || week.status === "published"
        ? "published"
        : "closed"
      : dateDrivenStatus;

  const visibility = await updateSubmissionVisibility(
    supabase,
    week,
    nextStatus === "closed" || nextStatus === "published",
  );

  if (!visibility.ok) {
    return visibility;
  }

  let updatedWeek = week;
  const statusUpdated = nextStatus !== week.status;

  if (statusUpdated) {
    const { data: updated, error: updateError } = await supabase
      .from("weeks")
      .update({ status: nextStatus })
      .eq("id", week.id)
      .select(weekColumns)
      .maybeSingle<WeekRow>();

    if (updateError || !updated) {
      return {
        ok: false,
        status: 500,
        error: "No se pudo sincronizar el estado de la semana.",
      };
    }

    updatedWeek = updated;
  }

  return {
    ok: true,
    week: updatedWeek,
    season,
    summary: {
      weekId: week.id,
      seasonId: week.season_id,
      previousStatus: week.status,
      nextStatus,
      statusUpdated,
      officialResultsBefore: officialResultCount,
      weeklyResultsDeleted,
      reopened,
      submissionsChecked: visibility.checked,
      submissionsMadeVisible: visibility.madeVisible,
      submissionsMadeHidden: visibility.madeHidden,
    },
  };
}
