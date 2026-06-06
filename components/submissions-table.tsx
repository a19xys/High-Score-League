"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  formatExactDateTime,
  formatLongDateWithoutYear,
  formatRelativeTime,
  formatScore,
} from "@/lib/format";
import type { Game, Player, Submission, Week } from "@/types";
import { EmptyState } from "./ui/state";
import { DataTable } from "./ui/table";

type SubmissionRow = Submission & {
  player?: Player;
  week?: Week;
  game?: Game;
};

type SubmissionsTableProps = {
  submissions: SubmissionRow[];
  currentUserId?: string | null;
  currentUserInitials?: string | null;
  eyebrow?: string;
  showPlayer?: boolean;
  showWeek?: boolean;
  showSource?: boolean;
  showDetectedAt?: boolean;
  title?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

type SortKey = "attempt" | "score" | "submittedAt";
type SortDirection = "asc" | "desc";

type DecoratedSubmission = SubmissionRow & {
  attemptNumber: number | null;
  hideScore: boolean;
  isOwn: boolean;
  isBestForViewer: boolean;
  playerInitials: string;
  showHiddenUi: boolean;
  submittedAtTime: number;
  viewerCanSeeScore: boolean;
};

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

function getPlayerInitials(
  submission: SubmissionRow,
  currentUserId?: string | null,
  currentUserInitials?: string | null,
) {
  if (submission.player?.initials) {
    return submission.player.initials;
  }

  if (currentUserId && submission.playerId === currentUserId && currentUserInitials) {
    return currentUserInitials;
  }

  return "???";
}

function getAttemptKey(submission: SubmissionRow) {
  if (!submission.weekId || !submission.playerId) {
    return null;
  }

  return `${submission.weekId}:${submission.playerId}`;
}

function isScoreHidden(submission: SubmissionRow) {
  const isRevealedByWeekStatus =
    submission.week?.status === "closed" ||
    submission.week?.status === "published";

  return Boolean(submission.hidden) && !isRevealedByWeekStatus;
}

function getSubmittedAtTime(submission: SubmissionRow) {
  const time = new Date(submission.createdAt).getTime();

  return Number.isFinite(time) ? time : 0;
}

function decorateSubmissions(
  submissions: SubmissionRow[],
  currentUserId: string | null,
  currentUserInitials: string | null,
  ownHiddenScoresRevealed: boolean,
): DecoratedSubmission[] {
  const byAttemptKey = new Map<string, SubmissionRow[]>();

  for (const submission of submissions) {
    const attemptKey = getAttemptKey(submission);

    if (!attemptKey) {
      continue;
    }

    const current = byAttemptKey.get(attemptKey) ?? [];
    current.push(submission);
    byAttemptKey.set(attemptKey, current);
  }

  const attemptBySubmissionId = new Map<string, number>();

  for (const groupedSubmissions of byAttemptKey.values()) {
    groupedSubmissions
      .slice()
      .sort((a, b) => {
        const dateOrder = getSubmittedAtTime(a) - getSubmittedAtTime(b);

        return dateOrder || a.id.localeCompare(b.id);
      })
      .forEach((submission, index) => {
        attemptBySubmissionId.set(submission.id, index + 1);
      });
  }

  const decorated = submissions.map((submission) => {
    const isOwn = Boolean(currentUserId && submission.playerId === currentUserId);
    const hideScore = isScoreHidden(submission);
    const showHiddenUi = hideScore && submission.week?.status === "frozen";
    const viewerCanSeeScore =
      !hideScore || (showHiddenUi && isOwn && ownHiddenScoresRevealed);

    return {
      ...submission,
      attemptNumber: attemptBySubmissionId.get(submission.id) ?? null,
      hideScore,
      isOwn,
      isBestForViewer: false,
      playerInitials: getPlayerInitials(submission, currentUserId, currentUserInitials),
      showHiddenUi,
      submittedAtTime: getSubmittedAtTime(submission),
      viewerCanSeeScore,
    };
  });

  const bestByAttemptKey = new Map<string, DecoratedSubmission>();

  for (const submission of decorated) {
    if (!submission.valid || !submission.viewerCanSeeScore) {
      continue;
    }

    const attemptKey = getAttemptKey(submission);

    if (!attemptKey) {
      continue;
    }

    const currentBest = bestByAttemptKey.get(attemptKey);

    if (
      !currentBest ||
      submission.score > currentBest.score ||
      (submission.score === currentBest.score &&
        (submission.submittedAtTime < currentBest.submittedAtTime ||
          (submission.submittedAtTime === currentBest.submittedAtTime &&
            submission.id.localeCompare(currentBest.id) < 0)))
    ) {
      bestByAttemptKey.set(attemptKey, submission);
    }
  }

  const bestIds = new Set(
    Array.from(bestByAttemptKey.values()).map((submission) => submission.id),
  );

  return decorated.map((submission) => ({
    ...submission,
    isBestForViewer: bestIds.has(submission.id),
  }));
}

function sortSubmissions(
  submissions: DecoratedSubmission[],
  sortKey: SortKey,
  sortDirection: SortDirection,
) {
  return submissions.slice().sort((a, b) => {
    if (sortKey === "attempt") {
      const playerOrder = `${a.playerInitials} ${a.playerId}`.localeCompare(
        `${b.playerInitials} ${b.playerId}`,
        "es",
      );

      if (playerOrder !== 0) {
        return sortDirection === "asc" ? playerOrder : -playerOrder;
      }

      const attemptOrder =
        (a.attemptNumber ?? Number.MAX_SAFE_INTEGER) -
        (b.attemptNumber ?? Number.MAX_SAFE_INTEGER);

      if (attemptOrder !== 0) {
        return sortDirection === "asc" ? attemptOrder : -attemptOrder;
      }

      return a.submittedAtTime - b.submittedAtTime || a.id.localeCompare(b.id);
    }

    if (sortKey === "score") {
      if (a.viewerCanSeeScore !== b.viewerCanSeeScore) {
        return a.viewerCanSeeScore ? -1 : 1;
      }

      const scoreOrder = a.score - b.score;

      if (scoreOrder !== 0) {
        return sortDirection === "asc" ? scoreOrder : -scoreOrder;
      }

      return b.submittedAtTime - a.submittedAtTime || a.id.localeCompare(b.id);
    }

    const dateOrder = a.submittedAtTime - b.submittedAtTime;

    return sortDirection === "asc"
      ? dateOrder || a.id.localeCompare(b.id)
      : -dateOrder || a.id.localeCompare(b.id);
  });
}

function getHiddenScoreNote(submissions: DecoratedSubmission[], showWeek: boolean) {
  const hiddenSubmissions = submissions.filter((submission) => submission.showHiddenUi);

  if (hiddenSubmissions.length === 0) {
    return null;
  }

  const revealDates = new Set<string>();

  for (const submission of hiddenSubmissions) {
    if (!submission.week?.endsAt) {
      continue;
    }

    const revealDate = new Date(submission.week.endsAt);

    if (!Number.isFinite(revealDate.getTime())) {
      continue;
    }

    revealDate.setDate(revealDate.getDate() + 1);
    revealDates.add(formatLongDateWithoutYear(revealDate.toISOString()));
  }

  if (revealDates.size === 1) {
    const [revealDate] = Array.from(revealDates);

    return `Las puntuaciones ocultas se revelarán el ${revealDate}.`;
  }

  if (!showWeek) {
    return "Las puntuaciones ocultas se revelarán cuando cierre la semana.";
  }

  return "Las puntuaciones ocultas se revelarán al cierre de sus respectivas semanas.";
}

function SortableHeader({
  align = "left",
  children,
  currentDirection,
  isActive,
  label,
  onClick,
}: {
  align?: "left" | "right";
  children: ReactNode;
  currentDirection: SortDirection;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm font-semibold uppercase tracking-[0.02em] transition hover:text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
        isActive ? "text-circuit" : "theme-text-muted"
      } ${align === "right" ? "justify-end text-right" : "justify-start text-left"}`}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={`inline-flex h-4 w-4 items-center justify-center text-[11px] leading-none ${
          isActive ? "text-circuit" : "opacity-45"
        }`}
      >
        {isActive ? (currentDirection === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

function SubmissionsTableTopbar({
  action,
  eyebrow,
  title,
}: {
  action?: ReactNode;
  eyebrow?: string;
  title?: string;
}) {
  if (!action && !eyebrow && !title) {
    return null;
  }

  return (
    <div className="space-y-1">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase theme-text-muted">
          {eyebrow}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title ? (
          <h2 className="text-xl font-semibold theme-text">{title}</h2>
        ) : (
          <div />
        )}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

export function SubmissionsTable({
  submissions,
  currentUserId = null,
  currentUserInitials = null,
  eyebrow,
  showPlayer: _showPlayer = true,
  showWeek = true,
  showSource: _showSource = false,
  showDetectedAt: _showDetectedAt = false,
  title,
  emptyTitle = "Todavía no hay puntuaciones.",
  emptyDescription = "Los envíos aparecerán aquí cuando haya datos reales para esta sección.",
}: SubmissionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("submittedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [ownHiddenScoresRevealed, setOwnHiddenScoresRevealed] = useState(false);

  const decoratedSubmissions = useMemo(
    () =>
      decorateSubmissions(
        submissions,
        currentUserId,
        currentUserInitials,
        ownHiddenScoresRevealed,
      ),
    [currentUserId, currentUserInitials, ownHiddenScoresRevealed, submissions],
  );
  const sortedSubmissions = useMemo(
    () => sortSubmissions(decoratedSubmissions, sortKey, sortDirection),
    [decoratedSubmissions, sortDirection, sortKey],
  );
  const hiddenScoreNote = useMemo(
    () => getHiddenScoreNote(decoratedSubmissions, showWeek),
    [decoratedSubmissions, showWeek],
  );

  function toggleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "attempt" ? "asc" : "desc");
  }

  const hasOwnHiddenScores = decoratedSubmissions.some(
    (submission) => submission.showHiddenUi && submission.isOwn,
  );

  if (submissions.length === 0) {
    const emptyState = (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
      />
    );

    if (!title && !eyebrow) {
      return emptyState;
    }

    return (
      <div className="space-y-4">
        <SubmissionsTableTopbar eyebrow={eyebrow} title={title} />
        {emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SubmissionsTableTopbar
        action={
          hasOwnHiddenScores ? (
            <button
              aria-label={
                ownHiddenScoresRevealed
                  ? "Tapar mis puntuaciones ocultas"
                  : "Mostrar mis puntuaciones ocultas"
              }
              aria-pressed={ownHiddenScoresRevealed}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold theme-border theme-surface theme-text transition hover:text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
              onClick={() => setOwnHiddenScoresRevealed((current) => !current)}
              type="button"
            >
              <MaskIcon
                className="h-4 w-4 bg-current"
                src={
                  ownHiddenScoresRevealed
                    ? "/icons/eye_nohidden.png"
                    : "/icons/eye_hidden.png"
                }
              />
              <span className="hidden sm:inline">
                {ownHiddenScoresRevealed ? "Tapar mis ocultos" : "Ver mis ocultos"}
              </span>
              <span className="sm:hidden">
                {ownHiddenScoresRevealed ? "Tapar" : "Ver"}
              </span>
            </button>
          ) : null
        }
        eyebrow={eyebrow}
        title={title}
      />
      <DataTable>
        <thead className="text-xs font-semibold uppercase theme-table-head">
          <tr>
            {showWeek ? (
              <th className="min-w-0 px-3 py-2.5 text-left" scope="col">
                Semana
              </th>
            ) : null}
            <th className="whitespace-nowrap px-3 py-2.5 text-left" scope="col">
              <SortableHeader
                currentDirection={sortDirection}
                isActive={sortKey === "attempt"}
                label="Ordenar por intento"
                onClick={() => toggleSort("attempt")}
              >
                Intento
              </SortableHeader>
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right" scope="col">
              <SortableHeader
                align="right"
                currentDirection={sortDirection}
                isActive={sortKey === "score"}
                label="Ordenar por score"
                onClick={() => toggleSort("score")}
              >
                Score
              </SortableHeader>
            </th>
            <th className="hidden whitespace-nowrap px-3 py-2.5 text-right sm:table-cell" scope="col">
              <SortableHeader
                align="right"
                currentDirection={sortDirection}
                isActive={sortKey === "submittedAt"}
                label="Ordenar por envío"
                onClick={() => toggleSort("submittedAt")}
              >
                Envío
              </SortableHeader>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y theme-border theme-surface">
          {sortedSubmissions.map((submission) => {
            const ownHiddenScoreIsRevealed =
              submission.hideScore && submission.isOwn && ownHiddenScoresRevealed;
            const scoreIsHiddenFromViewer =
              submission.hideScore && !ownHiddenScoreIsRevealed;
            const isOwnBest = submission.isBestForViewer && submission.isOwn;
            const isRivalBest = submission.isBestForViewer && !submission.isOwn;

            return (
              <tr
                className={`theme-hover ${
                  isOwnBest
                    ? "bg-circuit/5 shadow-[inset_3px_0_0_rgba(0,201,167,0.65)]"
                    : isRivalBest
                      ? "bg-sky-500/5 shadow-[inset_3px_0_0_rgba(14,165,233,0.45)]"
                    : ""
                }`}
                key={submission.id}
              >
                {showWeek ? (
                  <td className="min-w-0 max-w-[10rem] px-3 py-3 theme-text-muted">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold theme-text">
                        {submission.week
                          ? `Semana ${submission.week.number}`
                          : "Semana desconocida"}
                      </p>
                      {submission.game ? (
                        <p className="truncate text-xs theme-text-muted">
                          {submission.game.title}
                        </p>
                      ) : null}
                    </div>
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-3 py-3 font-semibold theme-text">
                  <div className="inline-flex items-center gap-2">
                    <span>{submission.playerInitials}</span>
                    <span className="theme-text-muted">
                      #{submission.attemptNumber ?? "-"}
                    </span>
                    {isOwnBest ? (
                      <span className="inline-flex h-6 items-center gap-1 rounded-full border border-circuit/25 bg-circuit/10 px-2 text-[11px] font-bold text-circuit">
                        <MaskIcon className="h-3 w-3 bg-current" src="/icons/star.png" />
                        <span className="hidden sm:inline">Tu mejor intento</span>
                      </span>
                    ) : isRivalBest ? (
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-500"
                        title={`Mejor intento de ${submission.playerInitials}`}
                      >
                        <span className="sr-only">
                          Mejor intento de {submission.playerInitials}
                        </span>
                        <MaskIcon className="h-3 w-3 bg-current" src="/icons/star.png" />
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold theme-text">
                  {scoreIsHiddenFromViewer ? (
                    <span className="inline-flex min-w-20 justify-end">
                      {submission.showHiddenUi ? (
                        <span className="inline-flex rounded-full border border-circuit/25 bg-circuit/10 px-2 py-0.5 text-xs font-bold text-circuit">
                          Oculto
                        </span>
                      ) : (
                        <span className="theme-text-muted">Oculto</span>
                      )}
                    </span>
                ) : ownHiddenScoreIsRevealed ? (
                  <span className="inline-flex min-w-20 justify-end">
                    <span className="inline-flex rounded-full border border-circuit/30 bg-circuit/10 px-2 py-0.5 text-xs font-bold text-circuit">
                      {formatScore(submission.score)}
                    </span>
                  </span>
                  ) : (
                    <span className="inline-flex min-w-20 justify-end">
                      {formatScore(submission.score)}
                    </span>
                  )}
                </td>
                <td
                  className="hidden whitespace-nowrap px-3 py-3 text-right theme-text-muted sm:table-cell"
                  title={formatExactDateTime(submission.createdAt)}
                >
                  {formatRelativeTime(submission.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {hiddenScoreNote ? (
        <div className="flex items-start gap-2 rounded-lg border border-circuit/20 bg-circuit/10 px-3 py-2 text-sm theme-text-muted">
          <MaskIcon className="mt-0.5 h-4 w-4 bg-circuit" src="/icons/info.png" />
          <p>{hiddenScoreNote}</p>
        </div>
      ) : null}
    </div>
  );
}

