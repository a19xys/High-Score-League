import { formatExactDateTime, formatRelativeTime, formatScore } from "@/lib/format";
import type { Game, Player, Submission, Week } from "@/types";
import { EmptyState } from "./ui/state";
import { DataTable, TableHead } from "./ui/table";

type SubmissionRow = Submission & {
  player?: Player;
  week?: Week;
  game?: Game;
};

type SubmissionsTableProps = {
  submissions: SubmissionRow[];
  showPlayer?: boolean;
  showWeek?: boolean;
  showSource?: boolean;
  showDetectedAt?: boolean;
  emptyTitle?: string;
};

export function SubmissionsTable({
  submissions,
  showPlayer = true,
  showWeek = true,
  showSource = false,
  showDetectedAt = false,
  emptyTitle = "Todavía no hay puntuaciones.",
}: SubmissionsTableProps) {
  if (submissions.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description="Los envíos aparecerán aquí cuando haya datos reales o mocks para esta sección."
      />
    );
  }

  const labels = [
    ...(showPlayer ? ["Jugador"] : []),
    ...(showWeek ? ["Semana"] : []),
    "Puntuación",
    "Estado",
    ...(showSource ? ["Origen"] : []),
    "Enviada",
    ...(showDetectedAt ? ["Detectada"] : []),
    "Comentario",
  ];

  return (
    <DataTable>
      <TableHead labels={labels} />
      <tbody className="divide-y theme-border theme-surface">
        {submissions.map((submission) => {
          const isRevealedByWeekStatus =
            submission.week?.status === "closed" ||
            submission.week?.status === "published";
          const hideScore =
            Boolean(submission.hidden) &&
            !isRevealedByWeekStatus;

          return (
            <tr className="theme-hover" key={submission.id}>
              {showPlayer ? (
                <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                  {submission.player?.initials ?? "???"}
                  <span className="ml-2 text-xs font-normal theme-text-muted">
                    @{submission.player?.username ?? "desconocido"}
                  </span>
                </td>
              ) : null}
              {showWeek ? (
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {submission.week
                    ? `Semana ${submission.week.number}${submission.game ? ` · ${submission.game.title}` : ""}`
                    : "Semana desconocida"}
                </td>
              ) : null}
              <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                {hideScore ? "Puntuación oculta" : formatScore(submission.score)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                {!submission.valid
                  ? "Inválida"
                  : submission.hidden && !isRevealedByWeekStatus
                    ? "Oculta"
                    : "Visible"}
              </td>
              {showSource ? (
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {submission.source ?? "web"}
                </td>
              ) : null}
              <td
                className="whitespace-nowrap px-4 py-4 theme-text-muted"
                title={formatExactDateTime(submission.createdAt)}
              >
                {formatRelativeTime(submission.createdAt)}
              </td>
              {showDetectedAt ? (
                <td
                  className="whitespace-nowrap px-4 py-4 text-xs theme-text-muted"
                  title={
                    submission.detectedAt
                      ? formatExactDateTime(submission.detectedAt)
                      : undefined
                  }
                >
                  {submission.detectedAt
                    ? formatRelativeTime(submission.detectedAt)
                    : "-"}
                </td>
              ) : null}
              <td className="min-w-56 px-4 py-4 theme-text-muted">
                {submission.comment ?? "-"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
