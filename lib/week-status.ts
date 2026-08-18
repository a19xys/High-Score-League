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
  status: string;
  public_start_at?: string | null;
  public_freeze_at?: string | null;
  final_deadline_at?: string | null;
};

type WeekSeason = {
  status: string;
};

export type CanonicalWeekPublicState = "inactive" | "active" | "closed";

export type CanonicalWeekAuthority = {
  canPlayCompetition: boolean;
  derivedStatus: DerivedWeekStatus;
  publicState: CanonicalWeekPublicState;
  reason:
    | "official-results"
    | "week-published"
    | "season-completed"
    | "season-inactive"
    | "calendar-incomplete"
    | "week-inactive"
    | "week-active"
    | "week-closed";
};

function timestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function deriveCanonicalWeekAuthority(options: {
  week: WeekTiming;
  season: WeekSeason;
  hasOfficialResults?: boolean;
  now?: Date;
}): CanonicalWeekAuthority {
  const { week, season } = options;
  const rawStatus = String(week.status || "").toLowerCase();

  if (options.hasOfficialResults === true) {
    return {
      canPlayCompetition: false,
      derivedStatus: "published",
      publicState: "closed",
      reason: "official-results",
    };
  }

  if (rawStatus === "published") {
    return {
      canPlayCompetition: false,
      derivedStatus: "published",
      publicState: "closed",
      reason: "week-published",
    };
  }

  if (season.status === "completed") {
    return {
      canPlayCompetition: false,
      derivedStatus: "closed",
      publicState: "closed",
      reason: "season-completed",
    };
  }

  if (season.status !== "active") {
    return {
      canPlayCompetition: false,
      derivedStatus: "draft",
      publicState: "inactive",
      reason: "season-inactive",
    };
  }

  const nowTime = (options.now || new Date()).getTime();
  const opensAt = timestamp(week.public_start_at);
  const finalStretchAt = timestamp(week.public_freeze_at);
  const closesAt = timestamp(week.final_deadline_at);
  const hasInvalidFinalStretch = week.public_freeze_at != null && (
    finalStretchAt === null
    || (opensAt !== null && finalStretchAt < opensAt)
    || (closesAt !== null && finalStretchAt > closesAt)
  );

  if (opensAt === null || closesAt === null || opensAt >= closesAt || hasInvalidFinalStretch) {
    return {
      canPlayCompetition: false,
      derivedStatus: rawStatus === "draft" ? "draft" : "scheduled",
      publicState: "inactive",
      reason: "calendar-incomplete",
    };
  }

  if (nowTime < opensAt) {
    return {
      canPlayCompetition: false,
      derivedStatus: "scheduled",
      publicState: "inactive",
      reason: "week-inactive",
    };
  }

  if (nowTime >= closesAt) {
    return {
      canPlayCompetition: false,
      derivedStatus: "closed",
      publicState: "closed",
      reason: "week-closed",
    };
  }

  const finalStretch = finalStretchAt !== null && nowTime >= finalStretchAt;
  return {
    canPlayCompetition: true,
    derivedStatus: finalStretch ? "final_stretch" : "active",
    publicState: "active",
    reason: "week-active",
  };
}

export function getDerivedWeekStatus(
  week: WeekTiming,
  now = new Date(),
  hasOfficialResults = false,
): DerivedWeekStatus {
  return deriveCanonicalWeekAuthority({
    hasOfficialResults,
    now,
    season: { status: "active" },
    week,
  }).derivedStatus;
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
    case "scheduled":
      return "Inactiva";
    case "active":
    case "final_stretch":
      return "Activa";
    case "closed":
    case "published":
      return "Cerrada";
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
  seasonStatus = "active",
): WeekStatus {
  const authority = deriveCanonicalWeekAuthority({
    hasOfficialResults,
    now,
    season: { status: seasonStatus },
    week,
  });

  if (authority.derivedStatus === "published") return "published";
  if (authority.derivedStatus === "closed") return "closed";
  if (authority.derivedStatus === "final_stretch") return "frozen";
  if (authority.derivedStatus === "active") return "active";
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
