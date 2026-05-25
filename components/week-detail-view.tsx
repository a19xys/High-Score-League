import Link from "next/link";
import { GameHero } from "@/components/game-hero";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWeekRange } from "@/lib/format";
import type { Game, LeaderboardEntry, Season, Submission, Week, Player } from "@/types";

type WeekSubmission = Submission & {
  player?: Player;
  week?: Week;
  game?: Game;
};

type WeekDetailViewProps = {
  season: Season;
  week: Week;
  game: Game;
  leaderboard: LeaderboardEntry[];
  submissions: WeekSubmission[];
  dataMode?: "mock" | "supabase";
  hideDownloads?: boolean;
  leaderboardPending?: boolean;
  submissionsPending?: boolean;
  warning?: string | null;
  backHref?: string;
  backLabel?: string;
  seasonBackHref?: string;
  seasonBackLabel?: string;
};

export function WeekDetailView({
  season,
  week,
  game,
  leaderboard,
  submissions,
  dataMode = "mock",
  hideDownloads = false,
  leaderboardPending = false,
  submissionsPending = false,
  warning,
  backHref,
  backLabel,
  seasonBackHref,
  seasonBackLabel,
}: WeekDetailViewProps) {
  return (
    <div className="space-y-6">
      {backHref || seasonBackHref ? (
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          {backHref ? (
            <Link className="text-circuit hover:underline" href={backHref}>
              {backLabel ?? "← Volver"}
            </Link>
          ) : null}
          {seasonBackHref ? (
            <Link className="theme-text-muted hover:underline" href={seasonBackHref}>
              {seasonBackLabel ?? `← Volver a ${season.name}`}
            </Link>
          ) : null}
        </div>
      ) : null}
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
          {warning ? (
            <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
              {warning}
            </div>
          ) : null}
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
            {!hideDownloads ? (
              <div className="flex flex-wrap gap-3">
                <LinkButton href={week.manualUrl ?? "#"}>Descargar manual</LinkButton>
                <LinkButton href="#">Descargar juego</LinkButton>
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Leaderboard semanal"
          eyebrow={dataMode === "supabase" ? "Pendiente" : "Ranking"}
        />
        {leaderboardPending ? (
          <EmptyState
            title="Leaderboard pendiente de conectar."
            description="Las puntuaciones reales se mostrarán cuando conectemos submissions y weekly_results."
          />
        ) : leaderboard.length > 0 ? (
          <LeaderboardTable entries={leaderboard} />
        ) : (
          <EmptyState
            title="Todavía no hay puntuaciones para esta semana."
            description="Cuando conectemos Supabase, este detalle cargará envíos reales."
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Historial de envíos"
          eyebrow={dataMode === "supabase" ? "Pendiente" : "Envíos mock"}
        />
        {submissionsPending ? (
          <EmptyState
            title="Historial de envíos pendiente."
            description="Los envíos reales se cargarán cuando conectemos submissions."
          />
        ) : (
          <SubmissionsTable submissions={submissions} showWeek={false} />
        )}
      </Card>
    </div>
  );
}
