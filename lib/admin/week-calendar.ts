import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeasonRow, WeekRow } from "@/types/supabase";

type WeekCalendarRow = Pick<
  WeekRow,
  | "id"
  | "week_number"
  | "public_start_at"
  | "public_freeze_at"
  | "final_deadline_at"
  | "created_at"
>;

type WeekInput = {
  season_id: string;
  public_start_at: string | null;
  public_freeze_at: string | null;
  final_deadline_at: string | null;
};

export type ShiftedWeekSummary = {
  id: string;
  weekNumber: number;
  previousStartAt: string;
  previousEndAt: string;
  nextStartAt: string;
  nextEndAt: string;
};

function time(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function iso(value: number) {
  return new Date(value).toISOString();
}

export async function validateWeekWithinSeason(
  data: WeekInput,
  season: Pick<SeasonRow, "starts_at" | "ends_at">,
) {
  const seasonStartsAt = time(season.starts_at);
  const seasonEndsAt = time(season.ends_at);
  const startsAt = time(data.public_start_at);
  const endsAt = time(data.final_deadline_at);
  const freezeAt = time(data.public_freeze_at);

  if (
    seasonStartsAt === null ||
    seasonEndsAt === null ||
    startsAt === null ||
    endsAt === null
  ) {
    return null;
  }

  if (
    startsAt < seasonStartsAt ||
    endsAt > seasonEndsAt ||
    (freezeAt !== null && (freezeAt < startsAt || freezeAt > endsAt))
  ) {
    return "La semana debe estar dentro de las fechas de la temporada.";
  }

  return null;
}

export async function getNextWeekNumber(
  supabase: SupabaseClient,
  seasonId: string,
) {
  const { data, error } = await supabase
    .from("weeks")
    .select("week_number")
    .eq("season_id", seasonId)
    .order("week_number", { ascending: false })
    .limit(1);

  if (error) {
    return { ok: false as const, error: "No se pudo calcular el número de semana." };
  }

  return {
    ok: true as const,
    value: (((data ?? [])[0] as { week_number: number } | undefined)
      ?.week_number ?? 0) + 1,
  };
}

export async function renumberWeeksInSeason(
  supabase: SupabaseClient,
  seasonId: string,
) {
  const { data, error } = await supabase
    .from("weeks")
    .select("id,week_number,public_start_at,final_deadline_at,created_at")
    .eq("season_id", seasonId);

  if (error) {
    return { ok: false as const, error: "No se pudieron leer semanas para renumerar." };
  }

  const weeks = ((data ?? []) as Array<{
    id: string;
    week_number: number;
    public_start_at: string | null;
    final_deadline_at: string | null;
    created_at?: string;
  }>).sort((a, b) => {
    const aDate = a.public_start_at ?? a.final_deadline_at ?? a.created_at ?? "";
    const bDate = b.public_start_at ?? b.final_deadline_at ?? b.created_at ?? "";
    return aDate.localeCompare(bDate) || a.id.localeCompare(b.id);
  });

  const offset = 1_000_000;

  for (let index = 0; index < weeks.length; index += 1) {
    const { error: updateError } = await supabase
      .from("weeks")
      .update({ week_number: offset + index + 1 })
      .eq("id", weeks[index].id);

    if (updateError) {
      return { ok: false as const, error: "No se pudo preparar la renumeración de semanas." };
    }
  }

  for (let index = 0; index < weeks.length; index += 1) {
    const { error: updateError } = await supabase
      .from("weeks")
      .update({ week_number: index + 1 })
      .eq("id", weeks[index].id);

    if (updateError) {
      return { ok: false as const, error: "No se pudo renumerar semanas." };
    }
  }

  return { ok: true as const };
}

export async function resolveWeekOverlaps(
  supabase: SupabaseClient,
  data: WeekInput,
  season: Pick<SeasonRow, "ends_at">,
  allowShiftFollowingWeeks: boolean,
  excludeWeekId?: string,
) {
  const startsAt = time(data.public_start_at);
  const endsAt = time(data.final_deadline_at);

  if (startsAt === null || endsAt === null) {
    return { ok: true as const, shiftedWeeks: [] as ShiftedWeekSummary[] };
  }

  let query = supabase
    .from("weeks")
    .select("id,week_number,public_start_at,public_freeze_at,final_deadline_at,created_at")
    .eq("season_id", data.season_id)
    .not("public_start_at", "is", null)
    .not("final_deadline_at", "is", null);

  if (excludeWeekId) {
    query = query.neq("id", excludeWeekId);
  }

  const { data: weeksData, error } = await query;

  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: "No se pudo validar solape de fechas con otras semanas.",
    };
  }

  const weeks = ((weeksData ?? []) as WeekCalendarRow[]).sort((a, b) => {
    const aDate = a.public_start_at ?? a.final_deadline_at ?? a.created_at ?? "";
    const bDate = b.public_start_at ?? b.final_deadline_at ?? b.created_at ?? "";
    return aDate.localeCompare(bDate) || a.id.localeCompare(b.id);
  });

  const previousOverlap = weeks.find((week) => {
    const otherStart = time(week.public_start_at);
    const otherEnd = time(week.final_deadline_at);

    return (
      otherStart !== null &&
      otherEnd !== null &&
      otherStart < startsAt &&
      startsAt < otherEnd
    );
  });

  if (previousOverlap) {
    return {
      ok: false as const,
      status: 409,
      error: "Esta semana se solapa con una semana anterior de la misma temporada.",
    };
  }

  const firstFollowingOverlap = weeks.find((week) => {
    const otherStart = time(week.public_start_at);
    const otherEnd = time(week.final_deadline_at);

    return (
      otherStart !== null &&
      otherEnd !== null &&
      otherStart >= startsAt &&
      startsAt < otherEnd &&
      otherStart < endsAt
    );
  });

  if (!firstFollowingOverlap) {
    return { ok: true as const, shiftedWeeks: [] as ShiftedWeekSummary[] };
  }

  if (!allowShiftFollowingWeeks) {
    return {
      ok: false as const,
      status: 409,
      error:
        "Esta semana se solapa con semanas posteriores. Activa la opción de retrasar semanas posteriores para ajustar el calendario automáticamente.",
    };
  }

  const seasonEndsAt = time(season.ends_at);
  const shiftedWeeks: ShiftedWeekSummary[] = [];
  const updates: Array<{
    id: string;
    public_start_at: string;
    public_freeze_at: string | null;
    final_deadline_at: string;
  }> = [];
  let cursorEnd = endsAt;

  for (const week of weeks) {
    const otherStart = time(week.public_start_at);
    const otherEnd = time(week.final_deadline_at);

    if (otherStart === null || otherEnd === null || otherStart < startsAt) {
      continue;
    }

    if (otherStart > cursorEnd) {
      cursorEnd = Math.max(cursorEnd, otherEnd);
      continue;
    }

    const duration = otherEnd - otherStart;
    const freezeAt = time(week.public_freeze_at);
    const freezeOffset = freezeAt === null ? null : freezeAt - otherStart;
    const nextStart = cursorEnd + 1000;
    const nextEnd = nextStart + duration;
    const nextFreeze =
      freezeOffset === null ? null : nextStart + freezeOffset;

    if (seasonEndsAt !== null && nextEnd > seasonEndsAt) {
      return {
        ok: false as const,
        status: 409,
        error: "El desplazamiento haría que una semana saliera de las fechas de la temporada.",
      };
    }

    updates.push({
      id: week.id,
      public_start_at: iso(nextStart),
      public_freeze_at: nextFreeze === null ? null : iso(nextFreeze),
      final_deadline_at: iso(nextEnd),
    });
    shiftedWeeks.push({
      id: week.id,
      weekNumber: week.week_number,
      previousStartAt: week.public_start_at ?? "",
      previousEndAt: week.final_deadline_at ?? "",
      nextStartAt: iso(nextStart),
      nextEndAt: iso(nextEnd),
    });
    cursorEnd = nextEnd;
  }

  if (shiftedWeeks.length > 0) {
    const { data: officialResults, error: resultsError } = await supabase
      .from("weekly_results")
      .select("week_id")
      .in(
        "week_id",
        shiftedWeeks.map((week) => week.id),
      );

    if (resultsError) {
      return {
        ok: false as const,
        status: 500,
        error: "No se pudo comprobar si las semanas posteriores tienen resultados oficiales.",
      };
    }

    if ((officialResults ?? []).length > 0) {
      return {
        ok: false as const,
        status: 409,
        error: "No se pueden desplazar semanas con resultados oficiales.",
      };
    }
  }

  for (const update of updates) {
    const { id, ...changes } = update;
    const { error: updateError } = await supabase
      .from("weeks")
      .update(changes)
      .eq("id", id);

    if (updateError) {
      return {
        ok: false as const,
        status: 500,
        error: "No se pudieron retrasar semanas posteriores.",
      };
    }
  }

  return { ok: true as const, shiftedWeeks };
}
