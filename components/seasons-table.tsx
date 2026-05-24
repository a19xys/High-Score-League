"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCompactDateRange } from "@/lib/format";
import type { SeasonSummary } from "@/types";
import { PlayerHoverCard } from "./player-hover-card";
import { EmptyState } from "./ui/state";
import { DataTable } from "./ui/table";

type SortKey = "season" | "dates" | "status" | "leader";
type SortDirection = "asc" | "desc";

type SeasonsTableProps = {
  seasons: SeasonSummary[];
  enableControls?: boolean;
};

const columns: Array<{ key: SortKey; label: string }> = [
  { key: "season", label: "Temporada" },
  { key: "dates", label: "Fechas" },
  { key: "status", label: "Estado" },
  { key: "leader", label: "Líder" },
];

function publicSeasonStatus(status: SeasonSummary["season"]["status"]) {
  return status === "active" ? "Activa" : "Inactiva";
}

export function SeasonsTable({ seasons, enableControls = false }: SeasonsTableProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("dates");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const visibleSeasons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return seasons
      .filter(({ season, leader, champion }) => {
        const visibleLeader = champion ?? leader;
        const matchesQuery =
          normalizedQuery.length === 0 ||
          season.name.toLowerCase().includes(normalizedQuery) ||
          visibleLeader?.username.includes(normalizedQuery) ||
          visibleLeader?.initials.toLowerCase().includes(normalizedQuery);
        const publicStatus = season.status === "active" ? "active" : "inactive";
        const matchesStatus = status === "all" || status === publicStatus;

        return matchesQuery && matchesStatus;
      })
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        const getValue = (summary: SeasonSummary) => {
          const visibleLeader = summary.champion ?? summary.leader;
          switch (sortKey) {
            case "season":
              return summary.season.name;
            case "dates":
              return summary.season.startsAt;
            case "status":
              return publicSeasonStatus(summary.season.status);
            case "leader":
              return visibleLeader?.username ?? "";
          }
        };

        return String(getValue(a)).localeCompare(String(getValue(b))) * direction;
      });
  }, [query, seasons, sortDirection, sortKey, status]);

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  if (seasons.length === 0) {
    return (
      <EmptyState
        title="No hay temporadas visibles."
        description="Las temporadas futuras permanecen ocultas hasta que se publiquen."
      />
    );
  }

  return (
    <div className="space-y-4">
      {enableControls ? (
        <div className="grid gap-3 rounded-lg border p-4 theme-border theme-surface-muted md:grid-cols-4">
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold uppercase theme-text-muted">
              Temporada, fechas o líder
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
          <div>
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Ordenación
            </p>
            <p className="mt-2 text-sm theme-text-muted">
              Pulsa un encabezado.
            </p>
          </div>
        </div>
      ) : null}

      <DataTable>
        <thead className="text-xs font-semibold uppercase theme-table-head">
          <tr>
            {columns.map((column) => (
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
          {visibleSeasons.map(({ season, leader, champion }) => {
            const visibleLeader = champion ?? leader;

            return (
              <tr className="theme-hover" key={season.id}>
                <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                  {season.name}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {formatCompactDateRange(season.startsAt, season.endsAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {publicSeasonStatus(season.status)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {visibleLeader ? (
                    <PlayerHoverCard player={visibleLeader} />
                  ) : (
                    <span className="theme-text-muted">Pendiente</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <Link
                    className="font-semibold text-circuit hover:underline"
                    href={`/seasons/${season.id}`}
                  >
                    Ver temporada
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </div>
  );
}
