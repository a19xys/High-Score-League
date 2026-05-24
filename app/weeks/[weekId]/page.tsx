import { notFound } from "next/navigation";
import { WeekDetailView } from "@/components/week-detail-view";
import {
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

  return (
    <WeekDetailView
      game={game}
      leaderboard={getWeeklyLeaderboard(week.id)}
      season={season}
      submissions={getSubmissionsForWeek(week.id)}
      week={week}
    />
  );
}
