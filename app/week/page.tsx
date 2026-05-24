import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { currentWeek, getCurrentGame, getWeeklyLeaderboard } from "@/lib/mock-data";

export default function WeekPage() {
  const game = getCurrentGame();
  const leaderboard = getWeeklyLeaderboard(currentWeek.id);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div
          aria-label={game.imageAlt}
          className="flex min-h-80 items-end rounded-lg border border-slate-200 bg-[linear-gradient(135deg,#111827_0%,#0f766e_52%,#ef4444_100%)] p-6 text-white shadow-panel"
          role="img"
        >
          <div>
            <p className="text-sm font-semibold uppercase text-slate-200">
              Placeholder arcade
            </p>
            <h1 className="mt-2 text-4xl font-bold">{game.title}</h1>
            <p className="mt-2 text-slate-200">{game.genre}</p>
          </div>
        </div>

        <Card>
          <CardHeader
            eyebrow={`Semana ${currentWeek.number}`}
            title={game.title}
            action={<StatusBadge status={currentWeek.status} />}
          >
            {formatDate(currentWeek.startsAt)} - {formatDate(currentWeek.endsAt)}
          </CardHeader>
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold uppercase text-slate-500">
                Reglas
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                {currentWeek.rules.map((rule) => (
                  <li className="flex gap-2" key={rule}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-circuit" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
            <LinkButton href="/submit" variant="primary">
              Subir puntuacion
            </LinkButton>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="Leaderboard semanal" eyebrow="Mejores puntuaciones" />
        <LeaderboardTable entries={leaderboard} />
      </Card>
    </div>
  );
}
