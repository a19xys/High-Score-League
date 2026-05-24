import { notFound } from "next/navigation";
import { GameHero } from "@/components/game-hero";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWeekRange } from "@/lib/format";
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

  const leaderboard = getWeeklyLeaderboard(week.id);
  const weekSubmissions = getSubmissionsForWeek(week.id);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <GameHero game={game} />
        <Card>
          <CardHeader
            eyebrow={`${season.name} · Semana ${week.number}`}
            title={game.title}
            action={<StatusBadge status={week.status} />}
          >
            {formatWeekRange(week.startsAt, week.endsAt)}
          </CardHeader>
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold uppercase theme-text-muted">
                Reglas
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 theme-text-muted">
                {week.rules.map((rule) => (
                  <li className="flex gap-2" key={rule}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-circuit" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
            <LinkButton href={week.manualUrl ?? "#"}>Descargar manual semanal</LinkButton>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="Ranking semanal" eyebrow="Detalle" />
        {leaderboard.length > 0 ? (
          <LeaderboardTable entries={leaderboard} />
        ) : (
          <EmptyState
            title="Todavía no hay puntuaciones para esta semana."
            description="Cuando conectemos Supabase, este detalle cargará submissions reales."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Historial de submissions" eyebrow="Mock" />
        <SubmissionsTable submissions={weekSubmissions} showWeek={false} />
      </Card>
    </div>
  );
}
