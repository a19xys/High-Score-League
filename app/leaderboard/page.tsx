import { LeaderboardTable } from "@/components/leaderboard-table";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { currentWeek, getCurrentGame, getWeeklyLeaderboard } from "@/lib/mock-data";

export default function LeaderboardPage() {
  const game = getCurrentGame();
  const leaderboard = getWeeklyLeaderboard(currentWeek.id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          eyebrow={`Semana ${currentWeek.number}`}
          title={`Leaderboard semanal · ${game.title}`}
          action={<StatusBadge status={currentWeek.status} />}
        >
          Puntuación válida por jugador, número de subidas y diferencia respecto
          al primer puesto.
        </CardHeader>
        <LeaderboardTable entries={leaderboard} />
      </Card>
    </div>
  );
}
