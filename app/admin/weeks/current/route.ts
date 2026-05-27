import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminCurrentWeek } from "@/lib/data/admin-weeks";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();

  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : "/profile");
  }

  const current = await getAdminCurrentWeek(auth.supabase);

  if (!current.summary || current.activeCount !== 1) {
    redirect("/admin/weeks");
  }

  redirect(`/admin/weeks/${current.summary.week.id}`);
}
