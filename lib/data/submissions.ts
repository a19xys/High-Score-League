import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LeaderboardEntry, Player, Submission, Week } from "@/types";
import type { RealProfile, SubmissionRow, SubmissionSource } from "@/types/supabase";
import type { DataReadResult } from "./types";

const submissionColumns = `
  id,
  week_id,
  player_id,
  score,
  screenshot_path,
  screenshot_mime_type,
  screenshot_size_bytes,
  comment,
  is_hidden,
  is_valid,
  submitted_at,
  source,
  detected_at,
  rom_name,
  mame_version,
  client_version,
  duplicate_key,
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

type HiddenSubmissionActivityRow = {
  id: string;
  week_id: string;
  player_id: string;
  submitted_at: string;
  is_hidden: boolean;
  is_valid: boolean;
  source: SubmissionSource;
  detected_at: string | null;
  profile_id: string;
  profile_username: string;
  profile_initials: string;
  profile_avatar_url: string | null;
};

export function mapRealProfileToPlayer(profile: RealProfile): Player {
  return {
    id: profile.id,
    username: profile.username,
    initials: profile.initials,
    avatarUrl: profile.avatar_url ?? undefined,
    isAdmin: profile.is_admin,
  };
}

export type RealWeekSubmission = Submission & {
  player?: Player;
  week?: Week;
};

export async function getRealSubmissions(
  weekId?: string,
  playerId?: string,
): Promise<DataReadResult<SubmissionRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      rows: [],
      source: "supabase",
      error: "Supabase no esta configurado.",
    };
  }

  let query = supabase
    .from("submissions")
    .select(submissionColumns)
    .order("submitted_at", { ascending: false });

  if (weekId) {
    query = query.eq("week_id", weekId);
  }

  if (playerId) {
    query = query.eq("player_id", playerId);
  }

  const { data, error } = await query;

  if (error) {
    return {
      rows: [],
      source: "supabase",
      error: error.message,
    };
  }

  return {
    rows: (data ?? []) as SubmissionRow[],
    source: "supabase",
    error: null,
  };
}

export async function getHiddenSubmissionActivity(
  weekId: string,
): Promise<DataReadResult<SubmissionRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      rows: [],
      source: "supabase",
      error: "Supabase no esta configurado.",
    };
  }

  const { data, error } = await supabase.rpc(
    "get_week_hidden_submission_activity",
    { p_week_id: weekId },
  );

  if (error) {
    return {
      rows: [],
      source: "supabase",
      error: error.message,
    };
  }

  const rows = ((data ?? []) as HiddenSubmissionActivityRow[]).map((row) => ({
    id: row.id,
    week_id: row.week_id,
    player_id: row.player_id,
    score: 0,
    screenshot_path: null,
    screenshot_mime_type: null,
    screenshot_size_bytes: null,
    comment: null,
    is_hidden: row.is_hidden,
    is_valid: row.is_valid,
    submitted_at: row.submitted_at,
    source: row.source,
    detected_at: row.detected_at,
    rom_name: null,
    mame_version: null,
    client_version: null,
    duplicate_key: null,
    profiles: {
      id: row.profile_id,
      username: row.profile_username,
      initials: row.profile_initials,
      avatar_url: row.profile_avatar_url,
      is_admin: false,
    },
  }));

  return {
    rows,
    source: "supabase",
    error: null,
  };
}

export function mapSubmissionRowToSubmission(
  row: SubmissionRow,
  week?: Week,
): RealWeekSubmission {
  const profile = normalizeProfile(row.profiles);

  return {
    id: row.id,
    weekId: row.week_id,
    playerId: row.player_id,
    score: row.score,
    screenshotUrl: row.screenshot_path,
    screenshotMimeType: row.screenshot_mime_type,
    screenshotSizeBytes: row.screenshot_size_bytes,
    comment: row.comment ?? undefined,
    createdAt: row.submitted_at,
    valid: row.is_valid,
    hidden: row.is_hidden,
    source: row.source,
    detectedAt: row.detected_at,
    romName: row.rom_name,
    mameVersion: row.mame_version,
    clientVersion: row.client_version,
    duplicateKey: row.duplicate_key,
    player: profile ? mapRealProfileToPlayer(profile) : undefined,
    week,
  };
}

function isSubmissionVisibleForLeaderboard(row: SubmissionRow, weekStatus: Week["status"]) {
  return (
    row.is_valid &&
    (!row.is_hidden || weekStatus === "closed" || weekStatus === "published")
  );
}

export function buildLeaderboardFromSubmissions(
  rows: SubmissionRow[],
  weekStatus: Week["status"],
): LeaderboardEntry[] {
  const visibleRows = rows.filter((row) =>
    isSubmissionVisibleForLeaderboard(row, weekStatus),
  );
  const byPlayer = new Map<string, SubmissionRow[]>();

  for (const row of visibleRows) {
    const playerRows = byPlayer.get(row.player_id) ?? [];
    playerRows.push(row);
    byPlayer.set(row.player_id, playerRows);
  }

  const entries = Array.from(byPlayer.entries())
    .map(([, playerRows]) => {
      const profile = normalizeProfile(playerRows[0]?.profiles);

      if (!profile) {
        return null;
      }

      const bestScore = Math.max(...playerRows.map((row) => row.score));
      const lastSubmissionAt = playerRows
        .map((row) => row.submitted_at)
        .sort()
        .at(-1) as string;

      return {
        player: mapRealProfileToPlayer(profile),
        bestScore,
        uploads: playerRows.length,
        lastSubmissionAt,
      };
    })
    .filter((entry): entry is Omit<LeaderboardEntry, "rank" | "gapToFirst"> =>
      Boolean(entry),
    )
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) {
        return b.bestScore - a.bestScore;
      }

      return a.lastSubmissionAt.localeCompare(b.lastSubmissionAt);
    });

  const firstScore = entries[0]?.bestScore ?? 0;

  return entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    gapToFirst: firstScore - entry.bestScore,
  }));
}

export function countVisibleSubmissionsForLeaderboard(
  rows: SubmissionRow[],
  weekStatus: Week["status"],
) {
  return rows.filter((row) => isSubmissionVisibleForLeaderboard(row, weekStatus)).length;
}

