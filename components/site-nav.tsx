import { getRealSeasons } from "@/lib/data/seasons";
import { getRealWeeks } from "@/lib/data/weeks";
import type { ServerSession } from "@/lib/auth/session";
import { resolveMediaUrl } from "@/lib/media/resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSynchronizedSeasonStatus, getSynchronizedWeekStatus } from "@/lib/week-status";
import { SiteNavClient, type NavProfile, type SiteNavData } from "./site-nav-client";

async function getSupabaseNavData(profile: NavProfile): Promise<SiteNavData> {
  const [weeksResult, seasonsResult] = await Promise.all([
    getRealWeeks(),
    getRealSeasons(),
  ]);
  const now = new Date();
  const activeWeek =
    weeksResult.error
      ? null
      : weeksResult.rows
          .filter((week) => {
            const status = getSynchronizedWeekStatus(week, now);
            return status === "active" || status === "frozen";
          })
          .sort((a, b) => {
            const dateOrder = (a.public_start_at ?? "").localeCompare(
              b.public_start_at ?? "",
            );
            return dateOrder || a.week_number - b.week_number;
          })[0] ?? null;
  const activeSeason =
    seasonsResult.error
      ? null
      : seasonsResult.rows
          .filter((season) => getSynchronizedSeasonStatus(season, now) === "active")
          .sort((a, b) => {
            const dateOrder = (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
            return dateOrder || a.name.localeCompare(b.name);
          })[0] ?? null;

  return {
    activeWeekId: activeWeek?.id ?? null,
    activeSeasonId: activeSeason?.id ?? null,
    activeSeasonSlug: activeSeason?.slug ?? null,
    isSignedIn: true,
    profile,
  };
}

function getSignedOutNavData(): SiteNavData {
  return {
    activeWeekId: null,
    activeSeasonId: null,
    activeSeasonSlug: null,
    isSignedIn: false,
    profile: null,
  };
}

export async function SiteNav({ session }: { session: ServerSession }) {
  if (session.status !== "signed-in") {
    return <SiteNavClient data={getSignedOutNavData()} />;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return <SiteNavClient data={getSignedOutNavData()} />;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username,initials,avatar_url,avatar_storage_path")
    .eq("id", session.userId)
    .maybeSingle<{
      username: string | null;
      initials: string | null;
      avatar_url: string | null;
      avatar_storage_path: string | null;
    }>();

  const navProfile: NavProfile = {
    username: profile?.username ?? null,
    initials: profile?.initials ?? null,
    avatarUrl: resolveMediaUrl({
      storagePath: profile?.avatar_storage_path,
      legacyUrl: profile?.avatar_url,
    }),
    email: session.email,
  };

  return <SiteNavClient data={await getSupabaseNavData(navProfile)} />;
}
