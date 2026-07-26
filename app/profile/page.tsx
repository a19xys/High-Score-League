import {
  ProfileDashboard,
  type ProfileAuthData,
} from "@/components/profile-dashboard";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import { getAdminCurrentWeek } from "@/lib/data/admin-weeks";
import {
  emptyPlayerCompetitiveProfile,
  getPlayerCompetitiveProfile,
} from "@/lib/data/player-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RealProfile } from "@/types/supabase";
import type { Metadata } from "next";

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
  if (!profile?.is_admin) {
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
      />
    );
  }

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <ProfileDashboard
        adminCenter={{ isAdmin: false }}
        auth={{ status: "signed-out" }}
        competitive={emptyPlayerCompetitiveProfile()}
      />
    );
  }

  const profileResult = await ensureProfileForCurrentUser(supabase);
  const profile = profileResult.status === "ok" ? profileResult.profile : null;
  const [adminCenter, competitive] = await Promise.all([
    getAdminCenterData(supabase, profile),
    profile
      ? getPlayerCompetitiveProfile(profile.id, "owner")
      : Promise.resolve(emptyPlayerCompetitiveProfile()),
  ]);
  const auth: ProfileAuthData = {
    status: "signed-in",
    email: userData.user.email ?? "Email no disponible",
    profile,
    profileError:
      profileResult.status === "needs-input" ? profileResult.error : null,
    metadataUsername: metadataString(userData.user.user_metadata.username).trim(),
    metadataInitials: metadataString(userData.user.user_metadata.initials).trim(),
  };

  return (
    <ProfileDashboard
      adminCenter={adminCenter}
      auth={auth}
      competitive={competitive}
    />
  );
}
