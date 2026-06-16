"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTableDateRange } from "@/lib/format";
import type { WeekSummary } from "@/types";
import { PlayerHoverCard } from "./player-hover-card";
import { StatusBadge } from "./ui/status-badge";
import { EmptyState } from "./ui/state";
import { SortableHeaderButton } from "./ui/sortable-header-button";
import { DataTable } from "./ui/table";

type SortKey = "season" | "week" | "game" | "dates" | "status" | "leader";
type SortDirection = "asc" | "desc";

type WeeksTableProps = {
  weeks: WeekSummary[];
  enableControls?: boolean;
  currentWeekNumber?: number;
  disableWeekLinks?: boolean;
};

const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "season", label: "Temporada" },
  { key: "week", label: "Semana" },
  { key: "game", label: "Juego" },
  { key: "dates", label: "Fechas" },
  { key: "status", label: "Estado" },
  { key: "leader", label: "Líder" },
];

function isFutureWeek(summary: WeekSummary, currentWeekNumber?: number) {
  return (
    summary.season.status === "active" &&
    typeof currentWeekNumber === "number" &&
    summary.week.number > currentWeekNumber &&
    summary.week.status !== "published"
  );
}

function isSecretWeek(summary: WeekSummary, currentWeekNumber?: number) {
  return (
    isFutureWeek(summary, currentWeekNumber) ||
    summary.week.gameId === null ||
    summary.week.status === "draft"
  );
}

function publicWeekStatus(summary: WeekSummary) {
  if (summary.week.status === "active" || summary.week.status === "frozen") {
    return "active";
  }

  if (summary.week.status === "closed" || summary.week.status === "published") {
    return "closed";
  }

  return "inactive";
}

function publicStatusLabel(status: ReturnType<typeof publicWeekStatus>) {
  if (status === "active") {
    return "Activa";
  }

  if (status === "closed") {
    return "Cerrada";
  }

  return "Inactiva";
}

function stateLinkClass(status: ReturnType<typeof publicWeekStatus>) {
  if (status === "active") {
    return "text-circuit hover:underline";
  }

  if (status === "closed") {
    return "text-[var(--warning-text)] hover:underline";
  }

  return "theme-text-muted";
}

export function WeeksTable({
  weeks,
  enableControls = false,
  currentWeekNumber,
  disableWeekLinks = false,
}: WeeksTableProps) {
  const [query, setQuery] = useState("");
  const [season, setSeason] = useState("all");
  const [status, setStatus] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [genre, setGenre] = useState("all");
  const [leader, setLeader] = useState("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("dates");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filterOptions = useMemo(() => {
    const publicRows = weeks.filter((summary) => !isSecretWeek(summary, currentWeekNumber));
    const compactOptions = (values: string[]) =>
      [...new Set(values.filter((value) => value.trim().length > 0))].sort();

    return {
      seasons: [...new Set(weeks.map((summary) => summary.season.name))].sort(),
      publishers: compactOptions(publicRows.flatMap((summary) => summary.game.publishers)),
      genres: compactOptions(publicRows.flatMap((summary) => summary.game.taxonomyTags)),
      leaders: [
        ...new Map(
          publicRows
            .filter((summary) => summary.winner)
            .map((summary) => [summary.winner?.username, summary.winner]),
        ).values(),
      ].sort((a, b) => (a?.username ?? "").localeCompare(b?.username ?? "")),
    };
  }, [currentWeekNumber, weeks]);

  const visibleWeeks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return weeks
      .filter((summary) => {
        const secret = isSecretWeek(summary, currentWeekNumber);
        const publicStatus = publicWeekStatus(summary);
        const searchableValues = [
          summary.season.name,
          `Semana ${summary.week.number}`,
          String(summary.week.number),
          secret ? "Por anunciar" : summary.game.title,
          secret ? "" : summary.game.publishers.join(" "),
          secret ? "" : summary.game.taxonomyTags.join(" "),
          secret ? "" : summary.winner?.username,
          secret ? "" : summary.winner?.initials,
        ];

        const matchesQuery =
          normalizedQuery.length === 0 ||
          searchableValues.some((value) =>
            value?.toLowerCase().includes(normalizedQuery),
          );
        const matchesSeason = season === "all" || summary.season.name === season;
        const matchesStatus = status === "all" || status === publicStatus;
        const matchesPublisher =
          publisher === "all" || (!secret && summary.game.publishers.includes(publisher));
        const matchesGenre =
          genre === "all" || (!secret && summary.game.taxonomyTags.includes(genre));
        const matchesLeader =
          leader === "all" || (!secret && summary.winner?.username === leader);

        return (
          matchesQuery &&
          matchesSeason &&
          matchesStatus &&
          matchesPublisher &&
          matchesGenre &&
          matchesLeader
        );
      })
      .map((summary, index) => ({ summary, index }))
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        const getValue = (row: WeekSummary) => {
          const secret = isSecretWeek(row, currentWeekNumber);

          switch (sortKey) {
            case "season":
              return row.season.name;
            case "week":
              return row.week.number;
            case "game":
              return secret ? "Por anunciar" : row.game.title;
            case "dates":
              return row.week.startsAt;
            case "status":
              return publicStatusLabel(publicWeekStatus(row));
            case "leader":
              return secret ? "" : row.winner?.username ?? "";
          }
        };
        const valueA = getValue(a.summary);
        const valueB = getValue(b.summary);
        const result =
          typeof valueA === "number" && typeof valueB === "number"
            ? valueA - valueB
            : String(valueA).localeCompare(String(valueB));

        return result === 0 ? a.index - b.index : result * direction;
      })
      .map(({ summary }) => summary);
  }, [
    currentWeekNumber,
    publisher,
    genre,
    leader,
    query,
    season,
    sortDirection,
    sortKey,
    status,
    weeks,
  ]);

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  if (weeks.length === 0) {
    return (
      <EmptyState
        title="No hay semanas configuradas."
        description="Cuando haya semanas publicadas, aquí aparecerá el archivo de la liga."
      />
    );
  }

  return (
    <div className="space-y-4">
      {enableControls ? (
        <div className="space-y-4 rounded-lg border p-4 theme-border theme-surface-muted">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase theme-text">
              Filtros de semanas
            </h2>
            <button
              className="rounded-md px-3 py-2 text-sm font-semibold theme-surface-strong"
              onClick={() => setShowMoreFilters((current) => !current)}
              type="button"
            >
              Más filtros
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase theme-text-muted">
                Buscar
              </span>
              <input
                className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Escribe aquí..."
                value={query}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase theme-text-muted">
                Temporada
              </span>
              <select
                className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                onChange={(event) => setSeason(event.target.value)}
                value={season}
              >
                <option value="all">Todas</option>
                {filterOptions.seasons.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase theme-text-muted">
                Estado
              </span>
              <select
                className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="all">Todos</option>
                <option value="active">Activa</option>
                <option value="closed">Cerrada</option>
                <option value="inactive">Inactiva</option>
              </select>
            </label>
          </div>
          {showMoreFilters ? (
            <div className="grid gap-3 border-t pt-4 theme-border md:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase theme-text-muted">
                  Editor
                </span>
                <select
                  className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                  onChange={(event) => setPublisher(event.target.value)}
                  value={publisher}
                >
                  <option value="all">Todos</option>
                  {filterOptions.publishers.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase theme-text-muted">
                  Género
                </span>
                <select
                  className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                  onChange={(event) => setGenre(event.target.value)}
                  value={genre}
                >
                  <option value="all">Todos</option>
                  {filterOptions.genres.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase theme-text-muted">
                  Líder
                </span>
                <select
                  className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                  onChange={(event) => setLeader(event.target.value)}
                  value={leader}
                >
                  <option value="all">Todos</option>
                  {filterOptions.leaders.map((option) =>
                    option ? (
                      <option key={option.id} value={option.username}>
                        @{option.username}
                      </option>
                    ) : null,
                  )}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {visibleWeeks.length === 0 ? (
        <EmptyState
          title="No hay semanas con esos filtros."
          description="Prueba a cambiar el estado, temporada o búsqueda."
        />
      ) : (
        <DataTable>
          <thead className="text-xs font-semibold uppercase theme-table-head">
            <tr>
              {sortableColumns.map((column) => (
                <th
                  className={`whitespace-nowrap px-2 py-3 sm:px-3 ${
                    column.key === "dates"
                      ? "hidden md:table-cell"
                      : column.key === "status"
                        ? "hidden sm:table-cell"
                        : column.key === "leader"
                          ? "hidden lg:table-cell"
                          : column.key === "game"
                            ? "hidden sm:table-cell"
                            : ""
                  }`}
                  key={column.key}
                  scope="col"
                >
                  <SortableHeaderButton
                    currentDirection={sortDirection}
                    isActive={sortKey === column.key}
                    label={`Ordenar por ${column.label.toLowerCase()}`}
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label}
                  </SortableHeaderButton>
                </th>
              ))}
              <th className="hidden whitespace-nowrap px-3 py-3 sm:table-cell" scope="col" />
            </tr>
          </thead>
          <tbody className="divide-y theme-border theme-surface">
            {visibleWeeks.map((summary) => {
              const secret = isSecretWeek(summary, currentWeekNumber);
              const publicStatus = publicWeekStatus(summary);
              const linkDisabled = secret || disableWeekLinks;

              return (
                <tr className="theme-hover" key={summary.week.id}>
                  <td className="w-[46%] min-w-0 px-2 py-4 theme-text-muted sm:w-auto sm:px-3">
                    <div className="min-w-0">
                      <p className="truncate">{summary.season.name}</p>
                      <p className="mt-1 truncate text-xs md:hidden">
                        {formatTableDateRange(summary.week.startsAt, summary.week.endsAt)}
                      </p>
                    </div>
                  </td>
                  <td className="w-[54%] min-w-0 px-2 py-4 font-semibold sm:w-auto sm:px-3">
                    {linkDisabled || publicStatus === "inactive" ? (
                      <span className="theme-text">Semana {summary.week.number}</span>
                    ) : (
                      <>
                        <Link
                          className={`sm:hidden ${stateLinkClass(publicStatus)}`}
                          href={`/weeks/${summary.week.id}`}
                        >
                          Semana {summary.week.number}
                        </Link>
                        <span className="hidden theme-text sm:inline">
                          Semana {summary.week.number}
                        </span>
                      </>
                    )}
                    <p className="mt-1 truncate text-xs font-normal theme-text-muted sm:hidden">
                      {secret ? "Por anunciar" : summary.game.title}
                    </p>
                  </td>
                  <td className="hidden min-w-0 max-w-[10rem] px-3 py-4 theme-text sm:table-cell lg:max-w-xs">
                    <p className="truncate">{secret ? "Por anunciar" : summary.game.title}</p>
                  </td>
                  <td className="hidden whitespace-nowrap px-1 py-4 theme-text-muted md:table-cell">
                    {formatTableDateRange(summary.week.startsAt, summary.week.endsAt)}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-4 sm:table-cell">
                    <StatusBadge
                      status={
                        publicStatus === "active"
                          ? "active"
                          : publicStatus === "closed"
                            ? "closed"
                            : "draft"
                      }
                    />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-4 lg:table-cell">
                    {!secret && summary.winner ? (
                      <PlayerHoverCard player={summary.winner} />
                    ) : (
                      <span className="theme-text-muted">Pendiente</span>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-4 sm:table-cell">
                    {linkDisabled ? (
                      <span
                        className="cursor-not-allowed font-semibold theme-text-muted"
                        title={
                          disableWeekLinks
                            ? "Detalle no disponible todavía."
                            : "Semana no disponible todavia."
                        }
                      >
                        No disponible
                      </span>
                    ) : (
                      <Link
                        className="font-semibold text-circuit hover:underline"
                        href={`/weeks/${summary.week.id}`}
                      >
                        Ver semana
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
