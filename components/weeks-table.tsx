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
    typeof currentWeekNumber === "number" &&
    summary.week.number > currentWeekNumber &&
    summary.week.status !== "published"
  );
}

export function WeeksTable({
  weeks,
  enableControls = false,
  currentWeekNumber,
}: WeeksTableProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("week");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const visibleWeeks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return weeks
      .filter((summary) => {
        const future = isFutureWeek(summary, currentWeekNumber);
        const searchableGame = future ? "juego secreto" : summary.game.title;
        const matchesQuery =
          normalizedQuery.length === 0 ||
          summary.season.name.toLowerCase().includes(normalizedQuery) ||
          searchableGame.toLowerCase().includes(normalizedQuery) ||
          String(summary.week.number).includes(normalizedQuery) ||
          summary.winner?.username.includes(normalizedQuery) ||
          summary.winner?.initials.toLowerCase().includes(normalizedQuery);
        const publicStatus = summary.week.status === "active" ? "active" : "inactive";
        const matchesStatus = status === "all" || status === publicStatus;

        return matchesQuery && matchesStatus;
      })
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        const getValue = (summary: WeekSummary) => {
          const future = isFutureWeek(summary, currentWeekNumber);
          switch (sortKey) {
            case "season":
              return summary.season.name;
            case "week":
              return summary.week.number;
            case "game":
              return future ? "Juego secreto" : summary.game.title;
            case "dates":
              return summary.week.startsAt;
            case "status":
              return summary.week.status === "active" ? "Activa" : "Inactiva";
            case "leader":
              return summary.winner?.username ?? "";
          }
        };
        const valueA = getValue(a);
        const valueB = getValue(b);

        if (typeof valueA === "number" && typeof valueB === "number") {
          return (valueA - valueB) * direction;
        }

        return String(valueA).localeCompare(String(valueB)) * direction;
      });
  }, [currentWeekNumber, query, sortDirection, sortKey, status, weeks]);

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
        <div className="grid gap-3 rounded-lg border p-4 theme-border theme-surface-muted md:grid-cols-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase theme-text-muted">
              Temporada, juego, semana o líder
            </span>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar..."
              value={query}
            />
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
              <option value="inactive">Inactiva</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Ordenación
            </p>
            <p className="mt-2 text-sm theme-text-muted">
              Pulsa un encabezado para ordenar. La tabla muestra el orden actual
              con ▲ / ▼.
            </p>
          </div>
        </div>
      ) : null}

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
            <th className="whitespace-nowrap px-4 py-3" scope="col">
              Detalle
            </th>
          </tr>
        </thead>
        <tbody className="divide-y theme-border theme-surface">
          {visibleWeeks.map((summary) => {
            const future = isFutureWeek(summary, currentWeekNumber);

            return (
              <tr className="theme-hover" key={summary.week.id}>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {summary.season.name}
                </td>
                <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                  Semana {summary.week.number}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text">
                  {future ? "Juego secreto" : summary.game.title}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {formatCompactDateRange(summary.week.startsAt, summary.week.endsAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <StatusBadge
                    status={summary.week.status === "active" ? "active" : "closed"}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {!future && summary.winner ? (
                    <PlayerHoverCard player={summary.winner} />
                  ) : (
                    <span className="theme-text-muted">Pendiente</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {future ? (
                    <span className="cursor-not-allowed font-semibold theme-text-muted">
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
    </div>
  );
}
