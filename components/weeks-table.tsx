"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCompactDateRange } from "@/lib/format";
import type { WeekSummary } from "@/types";
import { PlayerHoverCard } from "./player-hover-card";
import { StatusBadge } from "./ui/status-badge";
import { EmptyState } from "./ui/state";
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
    summary.game.title.trim().toLowerCase() === "juego secreto" ||
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

export function WeeksTable({
  weeks,
  enableControls = false,
  currentWeekNumber,
  disableWeekLinks = false,
}: WeeksTableProps) {
  const [query, setQuery] = useState("");
  const [season, setSeason] = useState("all");
  const [status, setStatus] = useState("all");
  const [developer, setDeveloper] = useState("all");
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
      developers: compactOptions(publicRows.flatMap((summary) => summary.game.developers)),
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
          secret ? "Juego secreto" : summary.game.title,
          secret ? "" : summary.game.developers.join(" "),
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
        const matchesDeveloper =
          developer === "all" || (!secret && summary.game.developers.includes(developer));
        const matchesGenre =
          genre === "all" || (!secret && summary.game.taxonomyTags.includes(genre));
        const matchesLeader =
          leader === "all" || (!secret && summary.winner?.username === leader);

        return (
          matchesQuery &&
          matchesSeason &&
          matchesStatus &&
          matchesDeveloper &&
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
              return secret ? "Juego secreto" : row.game.title;
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
    developer,
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
        description="Cuando conectemos Supabase, aquí aparecerá el archivo de semanas de la liga."
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
                placeholder="Juego, temporada, semana o jugador"
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
                  Desarrollador
                </span>
                <select
                  className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                  onChange={(event) => setDeveloper(event.target.value)}
                  value={developer}
                >
                  <option value="all">Todos</option>
                  {filterOptions.developers.map((option) => (
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
                  Líder/Ganador
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
                <th className="whitespace-nowrap px-4 py-3" key={column.key} scope="col">
                  <button
                    className="inline-flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort(column.key)}
                    type="button"
                  >
                    {column.label}
                    {sortKey === column.key ? (
                      <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </button>
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-3" scope="col" />
            </tr>
          </thead>
          <tbody className="divide-y theme-border theme-surface">
            {visibleWeeks.map((summary) => {
              const secret = isSecretWeek(summary, currentWeekNumber);
              const publicStatus = publicWeekStatus(summary);
              const linkDisabled = secret || disableWeekLinks;

              return (
                <tr className="theme-hover" key={summary.week.id}>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {summary.season.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    Semana {summary.week.number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text">
                    {secret ? "Juego secreto" : summary.game.title}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {formatCompactDateRange(summary.week.startsAt, summary.week.endsAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
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
                  <td className="whitespace-nowrap px-4 py-4">
                    {!secret && summary.winner ? (
                      <PlayerHoverCard player={summary.winner} />
                    ) : (
                      <span className="theme-text-muted">Pendiente</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    {linkDisabled ? (
                      <span
                        className="cursor-not-allowed font-semibold theme-text-muted"
                        title={
                          disableWeekLinks
                            ? "Detalle real pendiente de conectar."
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
