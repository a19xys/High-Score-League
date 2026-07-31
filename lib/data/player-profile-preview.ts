import type { SupabaseClient } from "@supabase/supabase-js";

export type PlayerProfilePreview = {
  isCurrentUser: boolean;
  player: {
    id: string;
    username: string;
    initials: string;
    avatarUrl: string | null;
    bio: string | null;
  };
  stats: {
    victories: number;
    podiums: number;
    officialResults: number;
  } | null;
};

export type PlayerProfilePreviewResult =
  | { status: "ok"; preview: PlayerProfilePreview }
  | { status: "not-found"; preview: null }
  | { status: "error"; preview: null };

export async function getPlayerProfilePreview(
  supabase: SupabaseClient,
  username: string,
  currentUserId: string,
): Promise<PlayerProfilePreviewResult> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,username,initials,avatar_url,bio")
    .eq("username", username)
    .maybeSingle<{
      id: string;
      username: string;
      initials: string;
      avatar_url: string | null;
      bio: string | null;
    }>();

  if (profileError) {
    return { status: "error", preview: null };
  }

  if (!profile) {
    return { status: "not-found", preview: null };
  }

  const [victories, podiums, officialResults] = await Promise.all([
    supabase
      .from("weekly_results")
      .select("id", { count: "exact", head: true })
      .eq("player_id", profile.id)
      .eq("is_first_place", true),
    supabase
      .from("weekly_results")
      .select("id", { count: "exact", head: true })
      .eq("player_id", profile.id)
      .or(
        "is_first_place.eq.true,is_second_place.eq.true,is_third_place.eq.true",
      ),
    supabase
      .from("weekly_results")
      .select("id", { count: "exact", head: true })
      .eq("player_id", profile.id),
  ]);
  const statsUnavailable = Boolean(
    victories.error || podiums.error || officialResults.error,
  );

  return {
    status: "ok",
    preview: {
      isCurrentUser: profile.id === currentUserId,
      player: {
        id: profile.id,
        username: profile.username,
        initials: profile.initials,
        avatarUrl: profile.avatar_url,
        bio: profile.bio,
      },
      stats: statsUnavailable
        ? null
        : {
            victories: victories.count ?? 0,
            podiums: podiums.count ?? 0,
            officialResults: officialResults.count ?? 0,
          },
    },
  };
}
