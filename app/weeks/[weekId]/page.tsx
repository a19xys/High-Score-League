import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { WeekDetailView } from "@/components/week-detail-view";
import {
  currentWeek,
  getGameById,
  getSeasonById,
  getSubmissionsForWeek,
  getWeekById,
  getWeeklyLeaderboard,
  weeks,
} from "@/lib/mock-data";

export function generateStaticParams() {
  return weeks.map((week) => ({ weekId: week.id }));
}

type WeekDetailPageProps = {
  params: Promise<{
    weekId: string;
  }>;
};

export default async function WeekDetailPage({ params }: WeekDetailPageProps) {
  const { weekId } = await params;
  const week = getWeekById(weekId);

  if (!week) {
    notFound();
  }

  const game = getGameById(week.gameId);
  const season = getSeasonById(week.seasonId);

  if (!game || !season) {
    notFound();
  }

  const isFutureActiveSeasonWeek =
    season.status === "active" &&
    week.number > currentWeek.number &&
    week.status !== "published";

  if (isFutureActiveSeasonWeek) {
    return (
      <div className="space-y-6">
        <Link className="text-sm font-semibold text-circuit hover:underline" href="/weeks">
          ← Volver a semanas
        </Link>
        <Card>
          <CardHeader eyebrow={`${season.name} · Semana ${week.number}`} title="Juego secreto" />
          <EmptyState
            title="Esta semana todavía no está disponible."
            description="El juego, reglas y líder permanecerán ocultos hasta que se active la semana."
          />
        </Card>
      </div>
    );
  }

  return (
    <WeekDetailView
      backHref="/weeks"
      backLabel="← Volver a semanas"
      game={game}
      leaderboard={getWeeklyLeaderboard(week.id)}
      season={season}
      seasonBackHref={`/seasons/${season.id}`}
      seasonBackLabel={`← Volver a ${season.name}`}
      submissions={getSubmissionsForWeek(week.id)}
      week={week}
    />
  );
}
