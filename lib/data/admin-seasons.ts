import type { SupabaseClient } from "@supabase/supabase-js";
import { adminSeasonColumns } from "@/lib/admin/seasons";
import {
  getSynchronizedSeasonStatus,
  getSynchronizedWeekStatus,
} from "@/lib/week-status";
import type { SeasonRow, WeekRow, RealProfile } from "@/types/supabase";

export type AdminSeasonSummary = {
  season: SeasonRow;
  weekCount: number;
  memberCount: number;
};

export type AdminSeasonMember = {
  playerId: string;
  status: string;
  joinedAt: string;
  profile?: RealProfile | null;
};

export type AdminSeasonDetail = AdminSeasonSummary & {
  weeks: WeekRow[];
  members: AdminSeasonMember[];
};

const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";
const membershipColumns = `
  id,
  season_id,
  player_id,
  status,
  joined_at,
  created_at,
  profiles:player_id (
    id,
    username,
    initials,
    avatar_url,
    is_admin,
    created_at,
    updated_at
  )
`;

function normalizeProfile(profile: RealProfile | RealProfile[] | null | undefined) {
  return Array.isArray(profile) ? profile[0] : profile;
}

export async function getAdminSeasonSummaries(supabase: SupabaseClient) {
  const [seasons, weeks, memberships] = await Promise.all([
    supabase
      .from("seasons")
      .select(adminSeasonColumns)
      .order("starts_at", { ascending: false, nullsFirst: false }),
    supabase.from("weeks").select("id,season_id"),
    supabase.from("season_memberships").select("id,season_id"),
  ]);

  const error = seasons.error ?? weeks.error ?? memberships.error;

  if (error) {
    return { rows: [], error: error.message };
  }

  const weekCounts = ((weeks.data ?? []) as Array<{ season_id: string }>).reduce<
    Record<string, number>
  >((counts, week) => {
    counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    return counts;
  }, {});
  const memberCounts = ((memberships.data ?? []) as Array<{ season_id: string }>).reduce<
    Record<string, number>
  >((counts, membership) => {
    counts[membership.season_id] = (counts[membership.season_id] ?? 0) + 1;
    return counts;
  }, {});

  return {
    rows: ((seasons.data ?? []) as SeasonRow[]).map((season) => ({
      season: {
        ...season,
        status: getSynchronizedSeasonStatus(season),
      },
      weekCount: weekCounts[season.id] ?? 0,
      memberCount: memberCounts[season.id] ?? 0,
    })),
    error: null,
  };
}

export async function getAdminSeasonDetail(
  supabase: SupabaseClient,
  seasonId: string,
) {
  const [season, weeks, memberships] = await Promise.all([
    supabase
      .from("seasons")
      .select(adminSeasonColumns)
      .or(`id.eq.${seasonId},slug.eq.${seasonId}`)
      .maybeSingle<SeasonRow>(),
    supabase
      .from("weeks")
      .select(weekColumns)
      .eq("season_id", seasonId)
      .order("week_number", { ascending: true }),
    supabase
      .from("season_memberships")
      .select(membershipColumns)
      .eq("season_id", seasonId)
      .order("joined_at", { ascending: true }),
  ]);

  if (season.error) {
    return { data: null, error: season.error.message };
  }

  if (!season.data) {
    return { data: null, error: null };
  }

  // If the route was opened by slug, re-read dependent rows using the real id.
  const realSeasonId = season.data.id;
  const detailWeeks =
    seasonId === realSeasonId
      ? weeks
      : await supabase
          .from("weeks")
          .select(weekColumns)
          .eq("season_id", realSeasonId)
          .order("week_number", { ascending: true });
  const detailMemberships =
    seasonId === realSeasonId
      ? memberships
      : await supabase
          .from("season_memberships")
          .select(membershipColumns)
          .eq("season_id", realSeasonId)
          .order("joined_at", { ascending: true });
  const error = detailWeeks.error ?? detailMemberships.error;

  if (error) {
    return { data: null, error: error.message };
  }

  const memberRows = (detailMemberships.data ?? []) as Array<{
    player_id: string;
    status: string;
    joined_at: string;
    profiles?: RealProfile | RealProfile[] | null;
  }>;

  return {
    data: {
      season: {
        ...season.data,
        status: getSynchronizedSeasonStatus(season.data),
      },
      weeks: ((detailWeeks.data ?? []) as WeekRow[]).map((week) => ({
        ...week,
        status: getSynchronizedWeekStatus(week),
      })),
      members: memberRows.map((membership) => ({
        playerId: membership.player_id,
        status: membership.status,
        joinedAt: membership.joined_at,
        profile: normalizeProfile(membership.profiles),
      })),
      weekCount: (detailWeeks.data ?? []).length,
      memberCount: memberRows.length,
    } satisfies AdminSeasonDetail,
    error: null,
  };
}
