import { WeekDetailView } from "@/components/week-detail-view";
import {
  currentSeason,
  currentWeek,
  getCurrentGame,
  getSubmissionsForWeek,
  getWeeklyLeaderboard,
} from "@/lib/mock-data";

export default function WeekPage() {
  const game = getCurrentGame();

  return (
    <WeekDetailView
      game={game}
      leaderboard={getWeeklyLeaderboard(currentWeek.id)}
      season={currentSeason}
      submissions={getSubmissionsForWeek(currentWeek.id)}
      week={currentWeek}
    />
  );
}
