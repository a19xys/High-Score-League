import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { currentSeason, currentWeek, getCurrentGame, getWeeklyLeaderboard } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";

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
            capturas validadas y clasificacion acumulada de temporada.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href="/leaderboard" variant="primary">
              Ver leaderboard
            </LinkButton>
            <LinkButton href="/submit">Subir puntuacion</LinkButton>
            <LinkButton href="/season">Clasificacion</LinkButton>
          </div>
        </div>

        <Card>
          <CardHeader eyebrow="Juego activo" title={game.title} action={<StatusBadge status={currentWeek.status} />}>
            Semana {currentWeek.number} · {formatDate(currentWeek.startsAt)} -{" "}
            {formatDate(currentWeek.endsAt)}
          </CardHeader>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-500">Estado de la semana</p>
            <p className="mt-2 text-2xl font-semibold text-ink">Competicion abierta</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Las mejores puntuaciones validas de cada jugador cuentan para el
              ranking semanal.
            </p>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="Top 3 semanal" eyebrow="Resumen" />
        <div className="grid gap-3 md:grid-cols-3">
          {topThree.map((entry) => (
            <div
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              key={entry.player.id}
            >
              <p className="text-sm font-semibold text-slate-500">#{entry.rank}</p>
              <p className="mt-2 text-lg font-semibold text-ink">{entry.player.name}</p>
              <p className="mt-1 text-2xl font-bold text-arcade">
                {entry.bestScore.toLocaleString("es-ES")}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Leaderboard semanal" eyebrow="Vista rapida" />
        <LeaderboardTable entries={leaderboard} />
      </Card>
    </div>
  );
}
