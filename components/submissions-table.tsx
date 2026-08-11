"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  formatExactDateTime,
  formatLongDateWithoutYear,
  formatRelativeTime,
  formatScore,
} from "@/lib/format";
import type { Game, Player, Submission, Week } from "@/types";
import {
  clampPage,
  getEmptyPageSlotCount,
  getTotalPages,
  paginateItems,
  type TablePageSize,
} from "@/lib/pagination";
import { PlayerPill } from "./player-pill";
import { EmptyState } from "./ui/state";
import { DataTable } from "./ui/table";
import { TablePagination } from "./ui/table-pagination";

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
  resetKey?: string | number;
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
        {isActive ? (
          currentDirection === "asc" ? (
            "▲"
          ) : (
            "▼"
          )
        ) : (
          <MaskIcon className="h-3.5 w-3.5 bg-current" src="/icons/sort-vertical.png" />
        )}
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

function getSubmissionRowContract(showWeek: boolean) {
  const rowHeightClass = showWeek ? "h-14" : "h-12";

  return {
    rowClassName: `${rowHeightClass} overflow-hidden`,
    cellClassName: `${rowHeightClass} overflow-hidden px-3 py-0 align-middle`,
  };
}

function SubmissionColumns({ showWeek }: { showWeek: boolean }) {
  return (
    <colgroup>
      {showWeek ? <col className="submission-col-week" /> : null}
      <col className="submission-col-attempt" />
      <col className="submission-col-score" />
    </colgroup>
  );
}

function EmptySubmissionRow({ showWeek }: { showWeek: boolean }) {
  const { cellClassName, rowClassName } = getSubmissionRowContract(showWeek);

  return (
    <tr aria-hidden="true" className={rowClassName}>
      {showWeek ? <td className={cellClassName} /> : null}
      <td className={cellClassName} />
      <td className={cellClassName} />
      <td className={`${cellClassName} submission-date-cell`} />
    </tr>
  );
}

export function SubmissionsTable({
  submissions,
  currentUserId = null,
  currentUserInitials = null,
  eyebrow,
  showPlayer = true,
  showWeek = true,
  showSource: _showSource = false,
  showDetectedAt: _showDetectedAt = false,
  title,
  emptyTitle = "Todavía no hay puntuaciones.",
  emptyDescription = "Los envíos aparecerán aquí cuando haya datos reales para esta sección.",
  resetKey,
}: SubmissionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("submittedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [ownHiddenScoresRevealed, setOwnHiddenScoresRevealed] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(10);

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
  const totalPages = getTotalPages(sortedSubmissions.length, pageSize);
  const safePage = clampPage(page, totalPages);
  const visibleSubmissions = useMemo(
    () => paginateItems(sortedSubmissions, safePage, pageSize),
    [pageSize, safePage, sortedSubmissions],
  );
  const emptyRowCount = getEmptyPageSlotCount(
    sortedSubmissions.length,
    visibleSubmissions.length,
    pageSize,
  );
  const hiddenScoreNote = useMemo(
    () => getHiddenScoreNote(decoratedSubmissions, showWeek),
    [decoratedSubmissions, showWeek],
  );

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  function toggleSort(nextSortKey: SortKey) {
    setPage(1);

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
  const { cellClassName, rowClassName } = getSubmissionRowContract(showWeek);

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
    <div className="submissions-table-region space-y-3">
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
      <DataTable
        className="submissions-table-shell"
        tableClassName={`submissions-table w-full table-fixed ${
          showWeek ? "submissions-table-has-week" : "submissions-table-no-week"
        }`}
      >
        <SubmissionColumns showWeek={showWeek} />
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
                label="Ordenar por intentos"
                onClick={() => toggleSort("attempt")}
              >
                Intentos
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
            <th className="submission-date-cell whitespace-nowrap px-3 py-2.5 text-right" scope="col">
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
          {visibleSubmissions.map((submission) => {
            const ownHiddenScoreIsRevealed =
              submission.hideScore && submission.isOwn && ownHiddenScoresRevealed;
            const scoreIsHiddenFromViewer =
              submission.hideScore && !ownHiddenScoreIsRevealed;
            const isOwnBest = submission.isBestForViewer && submission.isOwn;
            const isRivalBest = submission.isBestForViewer && !submission.isOwn;

            return (
              <tr
                className={`${rowClassName} theme-hover ${
                  isOwnBest
                    ? "bg-circuit/5 shadow-[inset_3px_0_0_rgba(0,201,167,0.65)]"
                    : isRivalBest
                      ? "bg-sky-500/5 shadow-[inset_3px_0_0_rgba(14,165,233,0.45)]"
                    : ""
                }`}
                key={submission.id}
              >
                {showWeek ? (
                  <td className={`${cellClassName} min-w-0 theme-text-muted`}>
                    <div className="max-h-10 min-w-0 overflow-hidden">
                      <p className="truncate text-sm font-semibold leading-5 theme-text">
                        {submission.week
                          ? `Semana ${submission.week.number}`
                          : "Semana desconocida"}
                      </p>
                      {submission.game ? (
                        <p className="truncate text-xs leading-4 theme-text-muted">
                          {submission.game.title}
                        </p>
                      ) : null}
                    </div>
                  </td>
                ) : null}
                <td className={`${cellClassName} min-w-0 whitespace-nowrap font-semibold theme-text`}>
                  <div className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
                    {showPlayer && submission.player ? (
                      <>
                        <span className="submission-player-rich min-w-0 overflow-hidden">
                          <PlayerPill
                            player={submission.player}
                            variant="submission"
                          />
                        </span>
                        <span className="submission-player-compact shrink-0">
                          {submission.playerInitials}
                        </span>
                      </>
                    ) : (
                      <span className="shrink-0">{submission.playerInitials}</span>
                    )}
                    <span className="shrink-0 theme-text-muted">
                      #{submission.attemptNumber ?? "-"}
                    </span>
                    {isOwnBest ? (
                      <span className="submission-best-marker h-6 min-w-0 items-center gap-1 overflow-hidden rounded-full border border-circuit/25 bg-circuit/10 px-2 text-[11px] font-bold text-circuit">
                        <MaskIcon className="h-3 w-3 bg-current" src="/icons/star.png" />
                        <span className="submission-best-copy truncate">Tu mejor intento</span>
                      </span>
                    ) : isRivalBest ? (
                      <span
                        className="submission-best-marker h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-500"
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
                <td className={`${cellClassName} min-w-0 whitespace-nowrap text-right font-semibold tabular-nums theme-text`}>
                  {scoreIsHiddenFromViewer ? (
                    <span className="flex w-full min-w-0 justify-end overflow-hidden">
                      {submission.showHiddenUi ? (
                        <span className="inline-flex rounded-full border border-circuit/25 bg-circuit/10 px-2 py-0.5 text-xs font-bold text-circuit">
                          Oculto
                        </span>
                      ) : (
                        <span className="theme-text-muted">Oculto</span>
                      )}
                    </span>
                ) : ownHiddenScoreIsRevealed ? (
                  <span className="flex w-full min-w-0 justify-end overflow-hidden">
                    <span className="max-w-full truncate rounded-full border border-circuit/30 bg-circuit/10 px-2 py-0.5 text-xs font-bold text-circuit">
                      {formatScore(submission.score)}
                    </span>
                  </span>
                  ) : (
                    <span
                      className="block w-full truncate text-right"
                      title={formatScore(submission.score)}
                    >
                      {formatScore(submission.score)}
                    </span>
                  )}
                </td>
                <td
                  className={`${cellClassName} submission-date-cell whitespace-nowrap text-right theme-text-muted`}
                  title={formatExactDateTime(submission.createdAt)}
                >
                  <span className="block truncate">
                    {formatRelativeTime(submission.createdAt)}
                  </span>
                </td>
              </tr>
            );
          })}
          {Array.from({ length: emptyRowCount }, (_, index) => (
            <EmptySubmissionRow
              key={`empty-submission-${safePage}-${index}`}
              showWeek={showWeek}
            />
          ))}
        </tbody>
      </DataTable>
      <TablePagination
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        page={safePage}
        pageSize={pageSize}
        totalItems={sortedSubmissions.length}
      />
      {hiddenScoreNote ? (
        <div className="flex items-start gap-2 rounded-lg border border-circuit/20 bg-circuit/10 px-3 py-2 text-sm theme-text-muted">
          <MaskIcon className="mt-0.5 h-4 w-4 bg-circuit" src="/icons/info.png" />
          <p>{hiddenScoreNote}</p>
        </div>
      ) : null}
    </div>
  );
}

