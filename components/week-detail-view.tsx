import Link from "next/link";
import { GameHero } from "@/components/game-hero";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, TableHead } from "@/components/ui/table";
import { formatScore, formatWeekRange } from "@/lib/format";
import type {
  Game,
  LeaderboardEntry,
  Season,
  Submission,
  Week,
  Player,
  WeekBenchmark,
  WeeklyResult,
} from "@/types";
import { RankBadge } from "./rank-badge";

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
  benchmarks?: WeekBenchmark[];
  submissions: WeekSubmission[];
  weeklyResults?: WeeklyResult[];
  dataMode?: "mock" | "supabase";
  hideDownloads?: boolean;
  leaderboardPending?: boolean;
  submissionsPending?: boolean;
  warning?: string | null;
  statusHelp?: string | null;
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
  benchmarks = [],
  submissions,
  weeklyResults = [],
  dataMode = "mock",
  hideDownloads = false,
  leaderboardPending = false,
  submissionsPending = false,
  warning,
  statusHelp,
  backHref,
  backLabel,
  seasonBackHref,
  seasonBackLabel,
}: WeekDetailViewProps) {
  const showOfficialResults = dataMode === "supabase" && week.status === "published";
  const weekInstructions = week.rules.filter((rule) => rule.trim());
  const gameInstructions = game.instructions?.trim() ?? "";
  const effectiveInstructions =
    weekInstructions.length > 0 ? weekInstructions.join("\n") : gameInstructions;
  const instructionSource =
    weekInstructions.length > 0
      ? "Instrucciones específicas de esta semana"
      : gameInstructions
        ? "Instrucciones del juego"
        : null;
  const manualHref = week.manualUrl ?? game.manualUrl;

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
          {statusHelp ? (
            <div className="mb-4 rounded-lg border p-4 text-sm theme-border theme-surface-muted theme-text-muted">
              {statusHelp}
            </div>
          ) : null}
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold uppercase theme-text-muted">
                Instrucciones
              </h2>
              {effectiveInstructions ? (
                <div className="mt-3 rounded-lg border p-4 theme-border theme-surface-muted">
                  {instructionSource ? (
                    <p className="text-xs font-semibold uppercase theme-text-muted">
                      {instructionSource}
                    </p>
                  ) : null}
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 theme-text-muted">
                    {effectiveInstructions}
                  </p>
                </div>
              ) : (
                <EmptyState
                  title="No hay instrucciones disponibles."
                  description="Añade instrucciones al juego o un override específico en la semana."
                />
              )}
            </div>
            {!hideDownloads ? (
              <div className="flex flex-wrap gap-3">
                {manualHref ? (
                  <LinkButton href={manualHref}>Ver manual</LinkButton>
                ) : null}
                <LinkButton href="#">Descargar juego</LinkButton>
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Leaderboard semanal"
          eyebrow={dataMode === "supabase" ? "Submissions reales" : "Ranking"}
        />
        {leaderboardPending ? (
          <EmptyState
            title="Leaderboard pendiente de conectar."
            description="Las puntuaciones reales se mostrarán cuando conectemos submissions y weekly_results."
          />
        ) : leaderboard.length > 0 || benchmarks.length > 0 ? (
          <LeaderboardTable benchmarks={benchmarks} entries={leaderboard} />
        ) : (
          <EmptyState
            title="Todavía no hay puntuaciones para esta semana."
            description={
              dataMode === "supabase"
                ? "Todavía no hay envíos visibles para construir el leaderboard."
                : "Cuando conectemos Supabase, este detalle cargará envíos reales."
            }
          />
        )}
      </Card>

      {showOfficialResults ? (
        <Card>
          <CardHeader title="Resultados oficiales" eyebrow="weekly_results">
            Lectura solo lectura. Estos resultados no se generan ni publican
            todavía desde la app.
          </CardHeader>
          {weeklyResults.length > 0 ? (
            <DataTable>
              <TableHead labels={["Puesto", "Jugador", "Puntuación", "Puntos"]} />
              <tbody className="divide-y theme-border theme-surface">
                {weeklyResults.map((result) => (
                  <tr className="theme-hover" key={result.id}>
                    <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                      <RankBadge rank={result.rank} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                      {result.player?.initials ?? "???"}
                      <span className="ml-2 text-xs font-normal theme-text-muted">
                        @{result.player?.username ?? "desconocido"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                      {formatScore(result.finalScore)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                      {result.leaguePoints}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              title="No hay resultados oficiales publicados."
              description="La tabla weekly_results se leerá aquí cuando exista contenido."
            />
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Historial de envíos"
          eyebrow={dataMode === "supabase" ? "Submissions reales" : "Envíos mock"}
        />
        {submissionsPending ? (
          <EmptyState
            title="Historial de envíos pendiente."
            description="Los envíos reales se cargarán cuando conectemos submissions."
          />
        ) : (
          <SubmissionsTable
            emptyTitle="Todavía no hay envíos para esta semana."
            showDetectedAt={dataMode === "supabase"}
            showSource={dataMode === "supabase"}
            showWeek={false}
            submissions={submissions}
          />
        )}
      </Card>
    </div>
  );
}
