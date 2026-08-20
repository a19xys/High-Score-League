export type PublicWeekVisibilityWeek = {
  game_id: string | null;
  status: string;
  week_number: number;
};

export type PublicWeekVisibilitySeason = {
  status: string;
};

export type PublicWeekVisibilityInput = {
  week: PublicWeekVisibilityWeek | null;
  season: PublicWeekVisibilitySeason | null;
  derivedStatus: string | null;
  currentActiveWeekNumber?: number | null;
};

export function resolvePublicWeekVisibility(input: PublicWeekVisibilityInput) {
  const { week, season, derivedStatus, currentActiveWeekNumber = null } = input;

  if (!week) {
    return { status: "unavailable" as const, reason: "not-found" as const };
  }

  const futureActiveSeasonWeek = season?.status === "active" &&
    typeof currentActiveWeekNumber === "number" &&
    week.week_number > currentActiveWeekNumber &&
    week.status !== "published";
  const visibleStatus = ["active", "final_stretch", "closed", "published"].includes(
    String(derivedStatus || ""),
  );

  if (!season || season.status === "draft" || !week.game_id || futureActiveSeasonWeek || !visibleStatus) {
    return { status: "unavailable" as const, reason: "not-public" as const };
  }

  return { status: "available" as const, reason: "public-week" as const };
}
