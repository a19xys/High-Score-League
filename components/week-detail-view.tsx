import Link from "next/link";
import { GameHero } from "@/components/game-hero";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable, TableHead } from "@/components/ui/table";
import { formatScore, formatWeekRange } from "@/lib/format";
import {
  getWeekStatusDisplay,
  type WeekDisplayTone,
  type WeekStatusDisplay,
} from "@/lib/week-display";
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

const statusToneClasses: Record<WeekDisplayTone, string> = {
  inactive:
    "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-200",
  active: "border-circuit/35 bg-circuit/10 text-circuit",
  frozen:
    "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  closed:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

const noticeToneClasses: Record<WeekDisplayTone, string> = {
  inactive:
    "border-slate-400/25 bg-slate-500/10 text-slate-700 dark:text-slate-200",
  active: "border-circuit/25 bg-circuit/10 text-circuit",
  frozen:
    "border-amber-400/35 bg-amber-500/10 text-amber-800 dark:text-amber-100",
  closed:
    "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

function WeekStatusPanel({ display }: { display: WeekStatusDisplay }) {
  return (
    <div
      className={`inline-flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left sm:w-auto sm:min-w-44 sm:flex-col sm:items-end sm:text-right ${statusToneClasses[display.tone]}`}
    >
      <span className="text-xs font-black uppercase tracking-[0.12em]">
        {display.label}
      </span>
      <span className="text-xs font-semibold opacity-90">
        {display.secondary}
      </span>
    </div>
  );
}

function WeekStatusNotice({ display }: { display: WeekStatusDisplay }) {
  return (
    <div
      className={`mb-4 rounded-lg border p-4 text-sm ${noticeToneClasses[display.tone]}`}
    >
      <p className="font-semibold" title={display.noticeTitleAttribute}>
        {display.noticeTitle}
      </p>
      {display.noticeBody ? (
        <p
          className="mt-1 opacity-85"
          title={display.noticeBodyTitleAttribute}
        >
          {display.noticeBody}
        </p>
      ) : null}
    </div>
  );
}

function getInstructionLines(week: Week, game: Game) {
  const weekLines = week.rules
    .map((rule) => rule.trim())
    .filter(Boolean);

  if (weekLines.length > 0) {
    return weekLines;
  }

  return (game.instructions ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function MaskIcon({
  className,
  src,
}: {
  className: string;
  src: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{
        WebkitMask: `url('${src}') center / contain no-repeat`,
        mask: `url('${src}') center / contain no-repeat`,
      }}
    />
  );
}

type WeekDetailViewProps = {
  season: Season;
  week: Week;
  game: Game;
  leaderboard: LeaderboardEntry[];
  benchmarks?: WeekBenchmark[];
  submissions: WeekSubmission[];
  currentUserId?: string | null;
  weeklyResults?: WeeklyResult[];
  dataMode?: "supabase";
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
  currentUserId = null,
  weeklyResults = [],
  dataMode = "supabase",
  hideDownloads = false,
  leaderboardPending = false,
  submissionsPending = false,
  warning,
  backHref,
  backLabel,
  seasonBackHref,
  seasonBackLabel,
}: WeekDetailViewProps) {
  const showOfficialResults = dataMode === "supabase" && week.status === "published";
  const instructionLines = getInstructionLines(week, game);
  const manualHref = week.manualUrl ?? game.manualUrl;
  const statusDisplay = getWeekStatusDisplay(week);

  return (
    <div className="space-y-6">
      {backHref || seasonBackHref ? (
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          {backHref ? (
            <Link className="text-circuit hover:underline" href={backHref}>
              {backLabel ?? "← Volver"}
            </Link>
          ) : null}
          {seasonBackHref ? (
            <Link className="theme-text-muted hover:underline" href={seasonBackHref}>
              {seasonBackLabel ?? `← Volver a ${season.name}`}
            </Link>
          ) : null}
        </div>
      ) : null}
      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <GameHero game={game} />
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-circuit">
                {season.name} · Semana {week.number}
              </p>
              <h2 className="text-xl font-black uppercase tracking-[0.02em] theme-text">
                {game.title}
              </h2>
              <div className="mt-2 inline-flex max-w-full items-center gap-2 text-sm theme-text-muted">
                <MaskIcon className="h-4 w-4 bg-current" src="/icons/calendar.png" />
                {formatWeekRange(week.startsAt, week.endsAt)}
              </div>
            </div>
            <div className="shrink-0">
              <WeekStatusPanel display={statusDisplay} />
            </div>
          </div>
          {warning ? (
            <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
              {warning}
            </div>
          ) : null}
          <WeekStatusNotice display={statusDisplay} />
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.12em] text-circuit">
                Instrucciones
              </h2>
              <div className="mt-3 rounded-lg border p-4 theme-border theme-surface-muted">
                {instructionLines.length > 0 ? (
                  <div className="max-h-36 overflow-y-auto overflow-x-hidden pr-1">
                    <ul className="list-disc space-y-2 pl-5 text-sm leading-6 marker:text-lg marker:font-black marker:text-circuit theme-text-muted">
                      {instructionLines.map((instruction, index) => (
                        <li className="break-words" key={`${index}-${instruction}`}>
                          {instruction}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm leading-6 theme-text-muted">
                    Todavía no hay instrucciones publicadas para esta semana.
                  </p>
                )}
              </div>
            </div>
            {!hideDownloads && manualHref ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold transition theme-border theme-surface theme-text theme-hover"
                  href={manualHref}
                  rel="noreferrer"
                  target="_blank"
                >
                  <MaskIcon className="mr-2 h-4 w-4 bg-current" src="/icons/book-open.png" />
                  Ver manual
                </a>
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Leaderboard semanal"
          eyebrow={dataMode === "supabase" ? "Submissions" : "Ranking"}
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
            title="Todaví­a no hay puntuaciones para esta semana."
            description={
              dataMode === "supabase"
                ? "Todaví­a no hay enví­os visibles para construir el leaderboard."
                : "Cuando conectemos Supabase, este detalle cargará enví­os reales."
            }
          />
        )}
      </Card>

      {showOfficialResults ? (
        <Card>
          <CardHeader title="Resultados oficiales" eyebrow="weekly_results">
            Estos resultados ya fueron confirmados por administración y cuentan
            para la clasificación de temporada.
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
              description="La tabla weekly_results se leerá aquí­ cuando exista contenido."
            />
          )}
        </Card>
      ) : null}

      <Card>
        {submissionsPending ? (
          <>
            <CardHeader
              title="Historial de enví­os"
              eyebrow="Submissions"
            />
          <EmptyState
            title="Historial de enví­os pendiente."
            description="Los enví­os reales se cargarán cuando conectemos submissions."
          />
          </>
        ) : (
          <SubmissionsTable
            currentUserId={currentUserId}
            eyebrow="Submissions"
            emptyTitle="Todavía no hay envíos para esta semana."
            showDetectedAt={dataMode === "supabase"}
            showSource={dataMode === "supabase"}
            showWeek={false}
            submissions={submissions}
            title="Historial de envíos"
          />
        )}
      </Card>
    </div>
  );
}
