import { LeaderboardTable } from "@/components/leaderboard-table";
import { LeagueChat } from "@/components/league-chat";
import { LinkButton } from "@/components/link-button";
import { getRankCardClass, RankBadge } from "@/components/rank-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatScore, formatWeekRange } from "@/lib/format";
import {
  currentSeason,
  currentWeek,
  getChatMessages,
  getCurrentGame,
  getWeeklyLeaderboard,
} from "@/lib/mock-data";

export default function HomePage() {
  const game = getCurrentGame();
  const leaderboard = getWeeklyLeaderboard();
  const topThree = leaderboard.slice(0, 3);
  const chatMessages = getChatMessages();

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-lg p-7 shadow-panel theme-surface-strong">
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
            High Score League
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">
            Liga privada de puntuaciones arcade con semanas competitivas,
            capturas validadas y clasificación acumulada de temporada.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href={`/weeks/${currentWeek.id}`} variant="primary">
              Leaderboard
            </LinkButton>
            <LinkButton href={`/seasons/${currentSeason.id}`}>Clasificación</LinkButton>
            <LinkButton href="/submit">Subir</LinkButton>
          </div>
        </div>

        <Card>
          <CardHeader
            eyebrow="Juego activo"
            title={game.title}
            action={<StatusBadge status={currentWeek.status} />}
          >
            Semana {currentWeek.number} ·{" "}
            {formatWeekRange(currentWeek.startsAt, currentWeek.endsAt)}
          </CardHeader>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-sm font-medium theme-text-muted">Estado de la semana</p>
            <p className="mt-2 text-2xl font-semibold theme-text">
              Competición abierta
            </p>
            <p className="mt-2 text-sm leading-6 theme-text-muted">
              Puedes subir varias puntuaciones válidas. El leaderboard muestra
              la mejor puntuación semanal de cada jugador.
            </p>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="Top 3 semanal" eyebrow="Resumen" />
        <div className="grid gap-3 md:grid-cols-3">
          {topThree.map((entry) => (
            <div
              className={`rounded-lg border p-4 ${getRankCardClass(entry.rank)}`}
              key={entry.player.id}
            >
              <RankBadge rank={entry.rank} />
              <p className="mt-3 text-xl font-bold theme-text">
                {entry.player.initials}
              </p>
              <p className="mt-1 text-sm theme-text-muted">@{entry.player.username}</p>
              <p className="mt-3 text-2xl font-bold theme-text">
                {formatScore(entry.bestScore)}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Leaderboard semanal" eyebrow="Vista rápida" />
        <LeaderboardTable entries={leaderboard} />
      </Card>

      <Card>
        <CardHeader title="Chat de la liga" eyebrow="Comentarios">
          Comentarios públicos mock. Supabase tendrá una tabla dedicada para
          persistirlos más adelante.
        </CardHeader>
        <LeagueChat messages={chatMessages} />
      </Card>
    </div>
  );
}
