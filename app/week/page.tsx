import { GameHero } from "@/components/game-hero";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatLongDate, formatWeekRange } from "@/lib/format";
import { currentWeek, getCurrentGame, getWeeklyLeaderboard } from "@/lib/mock-data";

export default function WeekPage() {
  const game = getCurrentGame();
  const leaderboard = getWeeklyLeaderboard(currentWeek.id);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <GameHero game={game} />

        <Card>
          <CardHeader
            eyebrow={`Semana ${currentWeek.number}`}
            title={game.title}
            action={<StatusBadge status={currentWeek.status} />}
          >
            {formatWeekRange(currentWeek.startsAt, currentWeek.endsAt)}
          </CardHeader>
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Cierre
                </p>
                <p className="mt-1 text-sm text-ink">
                  {formatDateTime(currentWeek.endsAt)}
                </p>
              </div>
              {currentWeek.revealAt ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Revelación
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    {formatLongDate(currentWeek.revealAt)}
                  </p>
                </div>
              ) : null}
            </div>

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

            <div className="flex flex-wrap gap-3">
              <LinkButton href="/submit" variant="primary">
                Subir puntuación
              </LinkButton>
              {currentWeek.manualUrl ? (
                <LinkButton href={currentWeek.manualUrl}>Manual semanal</LinkButton>
              ) : null}
            </div>
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
