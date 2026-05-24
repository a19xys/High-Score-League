import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { getRankCardClass, RankBadge } from "@/components/rank-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatScore, formatWeekRange } from "@/lib/format";
import {
  currentSeason,
  currentWeek,
  getCurrentGame,
  getWeeklyLeaderboard,
} from "@/lib/mock-data";

export default function HomePage() {
  const game = getCurrentGame();
  const leaderboard = getWeeklyLeaderboard();
  const topThree = leaderboard.slice(0, 3);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-lg bg-ink p-7 text-white shadow-panel">
          <p className="mb-3 text-sm font-semibold uppercase text-circuit">
            {currentSeason.name}
          </p>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
            High Score League
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">
            Liga privada de puntuaciones arcade con semanas competitivas,
            capturas validadas y clasificación acumulada de temporada.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href="/weeks" variant="primary">
              Ver leaderboard
            </LinkButton>
            <LinkButton href="/submit">Subir puntuación</LinkButton>
            <LinkButton href="/seasons">Clasificación</LinkButton>
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
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-500">Estado de la semana</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              Competición abierta
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
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
              <p className="mt-3 text-xl font-bold text-ink">
                {entry.player.initials}
              </p>
              <p className="mt-1 text-sm text-slate-500">@{entry.player.username}</p>
              <p className="mt-3 text-2xl font-bold text-ink">
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
    </div>
  );
}
