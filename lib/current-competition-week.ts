export type CurrentCompetitionPublicState = "inactive" | "active" | "closed";
export type CurrentCompetitionDerivedStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "final_stretch"
  | "closed"
  | "published";

type CurrentCompetitionWeek = {
  status: string;
  public_start_at?: string | null;
  public_freeze_at?: string | null;
  final_deadline_at?: string | null;
};

type CurrentCompetitionSeason = {
  status: string;
};

function timestamp(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function deriveCurrentCompetitionWeekState(options: {
  week: CurrentCompetitionWeek;
  season: CurrentCompetitionSeason;
  hasOfficialResults?: boolean;
  now?: Date;
}) {
  const { week, season } = options;
  const now = options.now || new Date();
  const hasOfficialResults = options.hasOfficialResults === true;
  const rawStatus = String(week.status || "").toLowerCase();

  if (hasOfficialResults || rawStatus === "published") {
    return {
      canPlayCompetition: false,
      derivedStatus: "published" as CurrentCompetitionDerivedStatus,
      publicState: "closed" as const,
      reason: hasOfficialResults ? "official-results" as const : "week-published" as const,
    };
  }

  if (rawStatus === "closed") {
    return {
      canPlayCompetition: false,
      derivedStatus: "closed" as CurrentCompetitionDerivedStatus,
      publicState: "closed" as const,
      reason: "week-closed" as const,
    };
  }

  if (season.status === "completed") {
    return {
      canPlayCompetition: false,
      derivedStatus: "closed" as CurrentCompetitionDerivedStatus,
      publicState: "closed" as const,
      reason: "season-completed" as const,
    };
  }

  if (season.status !== "active") {
    return {
      canPlayCompetition: false,
      derivedStatus: "draft" as CurrentCompetitionDerivedStatus,
      publicState: "inactive" as const,
      reason: "season-inactive" as const,
    };
  }

  const nowTime = now.getTime();
  const opensAt = timestamp(week.public_start_at);
  const freezesAt = timestamp(week.public_freeze_at);
  const closesAt = timestamp(week.final_deadline_at);

  if (opensAt !== null && nowTime < opensAt) {
    return {
      canPlayCompetition: false,
      derivedStatus: "scheduled" as CurrentCompetitionDerivedStatus,
      publicState: "inactive" as const,
      reason: "week-inactive" as const,
    };
  }

  if (closesAt !== null && nowTime >= closesAt) {
    return {
      canPlayCompetition: false,
      derivedStatus: "closed" as CurrentCompetitionDerivedStatus,
      publicState: "closed" as const,
      reason: "week-closed" as const,
    };
  }

  if (opensAt === null || nowTime < opensAt) {
    return {
      canPlayCompetition: false,
      derivedStatus: "scheduled" as CurrentCompetitionDerivedStatus,
      publicState: "inactive" as const,
      reason: "calendar-incomplete" as const,
    };
  }

  const finalStretch = freezesAt !== null && nowTime >= freezesAt;
  return {
    canPlayCompetition: true,
    derivedStatus: (finalStretch ? "final_stretch" : "active") as CurrentCompetitionDerivedStatus,
    publicState: "active" as const,
    reason: "week-active" as const,
  };
}
