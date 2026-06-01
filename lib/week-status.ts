import type { WeekStatus } from "@/types";
import type { WeekRow } from "@/types/supabase";
import type { SeasonStatus } from "@/types";

export type DerivedWeekStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "final_stretch"
  | "closed"
  | "published";

type WeekTiming = {
  status: WeekStatus;
  public_start_at?: string | null;
  public_freeze_at?: string | null;
  final_deadline_at?: string | null;
};

function timestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function getDerivedWeekStatus(
  week: WeekTiming,
  now = new Date(),
  hasOfficialResults = false,
): DerivedWeekStatus {
  if (hasOfficialResults || week.status === "published") {
    return "published";
  }

  if (week.status === "draft") {
    return "draft";
  }

  if (week.status === "closed") {
    return "closed";
  }

  const nowTime = now.getTime();
  const opensAt = timestamp(week.public_start_at);
  const finalStretchAt = timestamp(week.public_freeze_at);
  const closesAt = timestamp(week.final_deadline_at);

  if (opensAt !== null && nowTime < opensAt) {
    return "scheduled";
  }

  if (closesAt !== null && nowTime >= closesAt) {
    return "closed";
  }

  if (
    finalStretchAt !== null &&
    nowTime >= finalStretchAt &&
    (closesAt === null || nowTime < closesAt)
  ) {
    return "final_stretch";
  }

  if (opensAt !== null && nowTime >= opensAt) {
    return "active";
  }

  if (week.status === "frozen") {
    return "final_stretch";
  }

  if (week.status === "active") {
    return "active";
  }

  return "scheduled";
}

export function getDerivedWeekStatusFromRow(
  week: WeekRow,
  now = new Date(),
  hasOfficialResults = false,
) {
  return getDerivedWeekStatus(week, now, hasOfficialResults);
}

export function getPublicWeekStatusLabel(status: DerivedWeekStatus) {
  switch (status) {
    case "draft":
      return "Configuración";
    case "scheduled":
      return "Programada";
    case "active":
    case "final_stretch":
      return "Activa";
    case "closed":
      return "Cerrada";
    case "published":
      return "Resultados oficiales";
  }
}

export function getWeekStatusHelp(status: DerivedWeekStatus) {
  if (status === "final_stretch") {
    return "Tramo final activo: las nuevas puntuaciones se guardan ocultas hasta el cierre.";
  }

  if (status === "scheduled") {
    return "La semana todavía no ha alcanzado su fecha de apertura.";
  }

  if (status === "closed") {
    return "Semana cerrada. Puntuaciones reveladas. Resultados oficiales pendientes.";
  }

  if (status === "published") {
    return "Resultados oficiales publicados.";
  }

  return null;
}

export function derivedStatusToVisibleWeekStatus(
  status: DerivedWeekStatus,
): WeekStatus {
  if (status === "draft" || status === "scheduled") {
    return "draft";
  }

  if (status === "active" || status === "final_stretch") {
    return "active";
  }

  if (status === "published") {
    return "published";
  }

  return "closed";
}

export function getSynchronizedWeekStatus(
  week: Pick<
    WeekRow,
    | "status"
    | "public_start_at"
    | "public_freeze_at"
    | "final_deadline_at"
  >,
  now = new Date(),
  hasOfficialResults = false,
): WeekStatus {
  if (hasOfficialResults || week.status === "published") {
    return "published";
  }

  const nowTime = now.getTime();
  const opensAt = timestamp(week.public_start_at);
  const finalStretchAt = timestamp(week.public_freeze_at);
  const closesAt = timestamp(week.final_deadline_at);

  if (opensAt !== null && nowTime < opensAt) {
    return "draft";
  }

  if (closesAt !== null && nowTime >= closesAt) {
    return "closed";
  }

  if (
    finalStretchAt !== null &&
    nowTime >= finalStretchAt &&
    (closesAt === null || nowTime < closesAt)
  ) {
    return "frozen";
  }

  if (opensAt !== null && nowTime >= opensAt) {
    return "active";
  }

  return "draft";
}

export function getSynchronizedSeasonStatus(
  season: {
    starts_at?: string | null;
    ends_at?: string | null;
  },
  now = new Date(),
): SeasonStatus {
  const nowTime = now.getTime();
  const startsAt = timestamp(season.starts_at);
  const endsAt = timestamp(season.ends_at);

  if (startsAt !== null && nowTime < startsAt) {
    return "draft";
  }

  if (endsAt !== null && nowTime >= endsAt) {
    return "completed";
  }

  if (startsAt !== null && nowTime >= startsAt) {
    return "active";
  }

  return "draft";
}
