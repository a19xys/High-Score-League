import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { getDataSource } from "@/lib/data/data-source";
import { getRealWeeks } from "@/lib/data/weeks";
import { currentWeek } from "@/lib/mock-data";
import { getSynchronizedWeekStatus } from "@/lib/week-status";

export const dynamic = "force-dynamic";

async function getActiveWeekId() {
  if (getDataSource() !== "supabase") {
    return currentWeek.id;
  }

  const weeksResult = await getRealWeeks();

  if (weeksResult.error) {
    return null;
  }

  const now = new Date();
  const activeWeek = weeksResult.rows
    .filter((week) => {
      const status = getSynchronizedWeekStatus(week, now);
      return status === "active" || status === "frozen";
    })
    .sort((a, b) => {
      const dateOrder = (a.public_start_at ?? "").localeCompare(
        b.public_start_at ?? "",
      );
      return dateOrder || a.week_number - b.week_number;
    })[0];

  return activeWeek?.id ?? null;
}

export default async function GamePage() {
  const activeWeekId = await getActiveWeekId();

  if (activeWeekId) {
    redirect(`/weeks/${activeWeekId}`);
  }

  return (
    <Card>
      <CardHeader title="Leaderboard" eyebrow="Semana activa">
        No hay una semana activa en este momento.
      </CardHeader>
      <EmptyState
        action={
          <Link className="font-semibold text-circuit hover:underline" href="/weeks">
            Ver archivo de semanas
          </Link>
        }
        description="Cuando se abra una semana, esta ruta redirigirá automáticamente a su leaderboard."
        title="Sin leaderboard activo"
      />
    </Card>
  );
}
