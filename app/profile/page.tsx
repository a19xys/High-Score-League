import { ProfileDashboard } from "@/components/profile-dashboard";
import { getAdminCurrentWeek } from "@/lib/data/admin-weeks";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAdminCenterData() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { isAdmin: false };
  }

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return { isAdmin: false };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle<{ is_admin: boolean }>();

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
  const adminCenter = await getAdminCenterData();

  return <ProfileDashboard adminCenter={adminCenter} />;
}
