import {
  ProfileDashboard,
  type ProfileAuthData,
} from "@/components/profile-dashboard";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import { getVerifiedProductIdentity } from "@/lib/auth/session-context";
import { getAdminCurrentWeek } from "@/lib/data/admin-weeks";
import {
  emptyPlayerCompetitiveProfile,
  getPlayerCompetitiveProfile,
} from "@/lib/data/player-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RealProfile } from "@/types/supabase";
import { getPlayerPlayTime } from "@/lib/data/player-playtime";
import { getPlayerPresence } from "@/lib/data/player-presence";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Perfil | High Score League",
};

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function getAdminCenterData(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  profile: RealProfile | null,
) {
  if (!profile?.is_admin || profile.anonymized_at !== null) {
    return { isAdmin: false };
  }

  const currentWeek = await getAdminCurrentWeek(supabase);

  return {
    isAdmin: true,
    currentWeekId: currentWeek.summary?.week.id,
    currentWeekLabel: currentWeek.summary
      ? `${currentWeek.summary.season.name} · Semana ${currentWeek.summary.week.number}`
      : undefined,
    activeWeekCount: currentWeek.activeCount,
    error: currentWeek.error,
  };
}

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <ProfileDashboard
        adminCenter={{ isAdmin: false }}
        auth={{ status: "not-configured" }}
        competitive={emptyPlayerCompetitiveProfile()}
        playTime={{ visibility: "private" }}
        presence={{ visibility: "unavailable" }}
      />
    );
  }

  const identity = await getVerifiedProductIdentity(supabase.auth);

  if (identity.status !== "product") {
    return (
      <ProfileDashboard
        adminCenter={{ isAdmin: false }}
        auth={{ status: "signed-out" }}
        competitive={emptyPlayerCompetitiveProfile()}
        playTime={{ visibility: "private" }}
        presence={{ visibility: "unavailable" }}
      />
    );
  }

  const admin = createSupabaseAdminClient();

  if (admin) {
    const { data: lifecycleProfile } = await admin
      .from("profiles")
      .select("anonymized_at")
      .eq("id", identity.userId)
      .maybeSingle<{ anonymized_at: string | null }>();

    if (lifecycleProfile?.anonymized_at) {
      await supabase.auth.signOut({ scope: "local" });
      redirect("/");
    }
  }

  const profileResult = await ensureProfileForCurrentUser(
    supabase,
    identity.user,
  );

  if (profileResult.status === "inaccessible") {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/");
  }

  const profile = profileResult.status === "ok" ? profileResult.profile : null;
  const [adminCenter, competitive, playTimeResult, presence] = await Promise.all([
    getAdminCenterData(supabase, profile),
    profile
      ? getPlayerCompetitiveProfile(profile.id, "owner")
      : Promise.resolve(emptyPlayerCompetitiveProfile()),
    profile
      ? getPlayerPlayTime(supabase, profile.id, {
          isOwner: true,
          playTimePublic: profile.play_time_public === true,
        })
      : Promise.resolve({
          ok: true,
          playTime: { visibility: "private" },
        } as const),
    profile
      ? getPlayerPresence(profile.id)
      : Promise.resolve({ visibility: "unavailable" } as const),
  ]);
  const auth: ProfileAuthData = {
    status: "signed-in",
    email: identity.user.email ?? "Email no disponible",
    profile,
    profileError:
      profileResult.status === "needs-input" ? profileResult.error : null,
    metadataUsername: metadataString(identity.user.user_metadata?.username).trim(),
    metadataInitials: metadataString(identity.user.user_metadata?.initials).trim(),
  };

  return (
    <ProfileDashboard
      adminCenter={adminCenter}
      auth={auth}
      competitive={competitive}
      playTime={
        playTimeResult.ok
          ? playTimeResult.playTime
          : { visibility: "unavailable" }
      }
      presence={presence}
    />
  );
}
