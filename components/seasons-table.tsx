"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCompactDateRange } from "@/lib/format";
import type { SeasonSummary } from "@/types";
import { PlayerHoverCard } from "./player-hover-card";
import { SeasonJoinButton } from "./season-join-button";
import { EmptyState } from "./ui/state";
import { StatusBadge } from "./ui/status-badge";
import { DataTable } from "./ui/table";

type SortKey = "season" | "dates" | "status" | "leader";
type SortDirection = "asc" | "desc";
type PublicSeasonStatus = "active" | "closed" | "inactive";

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

function publicSeasonStatus(status: SeasonSummary["season"]["status"]): PublicSeasonStatus {
  if (status === "active") {
    return "active";
  }

  if (status === "completed") {
    return "closed";
  }

  return "inactive";
}

function statusSortLabel(status: PublicSeasonStatus) {
  if (status === "active") {
    return "Activa";
  }

  if (status === "closed") {
    return "Cerrada";
  }

  return "Inactiva";
}

export function SeasonsTable({ seasons, enableControls = false }: SeasonsTableProps) {
  const [status, setStatus] = useState("all");
  const [leader, setLeader] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("dates");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const leaders = useMemo(
    () =>
      [
        ...new Map(
          seasons
            .map((summary) => summary.champion ?? summary.leader)
            .filter(Boolean)
            .map((player) => [player?.username, player]),
        ).values(),
      ].sort((a, b) => (a?.username ?? "").localeCompare(b?.username ?? "")),
    [seasons],
  );

  const visibleSeasons = useMemo(() => {
    return seasons
      .filter(({ season, leader: currentLeader, champion }) => {
        const visibleLeader = champion ?? currentLeader;
        const publicStatus = publicSeasonStatus(season.status);
        const matchesStatus = status === "all" || status === publicStatus;
        const matchesLeader = leader === "all" || visibleLeader?.username === leader;

        return matchesStatus && matchesLeader;
      })
      .map((summary, index) => ({ summary, index }))
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        const getValue = (row: SeasonSummary) => {
          const visibleLeader = row.champion ?? row.leader;

          switch (sortKey) {
            case "season":
              return row.season.name;
            case "dates":
              return row.season.startsAt;
            case "status":
              return statusSortLabel(publicSeasonStatus(row.season.status));
            case "leader":
              return visibleLeader?.username ?? "";
          }
        };
        const result = String(getValue(a.summary)).localeCompare(String(getValue(b.summary)));

        return result === 0 ? a.index - b.index : result * direction;
      })
      .map(({ summary }) => summary);
  }, [leader, seasons, sortDirection, sortKey, status]);

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
        <div className="rounded-lg border p-4 theme-border theme-surface-muted">
          <h2 className="text-sm font-semibold uppercase theme-text">
            Filtros de temporadas
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
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
                {leaders.map((option) =>
                  option ? (
                    <option key={option.id} value={option.username}>
                      @{option.username}
                    </option>
                  ) : null,
                )}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {visibleSeasons.length === 0 ? (
        <EmptyState
          title="No hay temporadas con esos filtros."
          description="Cambia el estado o el líder seleccionado."
        />
      ) : (
        <DataTable>
          <thead className="text-xs font-semibold uppercase theme-table-head">
            <tr>
              {columns.map((column) => (
                <th className="whitespace-nowrap px-5 py-4" key={column.key} scope="col">
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
              <th className="whitespace-nowrap px-5 py-4" scope="col" />
              <th className="whitespace-nowrap px-5 py-4" scope="col">
                Inscripción
              </th>
            </tr>
          </thead>
          <tbody className="divide-y theme-border theme-surface">
            {visibleSeasons.map(({
              season,
              leader: currentLeader,
              champion,
              membershipStatus,
            }) => {
              const visibleLeader = champion ?? currentLeader;
              const publicStatus = publicSeasonStatus(season.status);

              return (
                <tr className="theme-hover" key={season.id}>
                  <td className="whitespace-nowrap px-5 py-6">
                    <div>
                      <p className="font-semibold theme-text">{season.name}</p>
                      <p className="mt-1 text-xs uppercase theme-text-muted">
                        {season.weekCount} semanas
                      </p>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-6 theme-text-muted">
                    {formatCompactDateRange(season.startsAt, season.endsAt)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-6">
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
                  <td className="whitespace-nowrap px-5 py-6">
                    {visibleLeader ? (
                      <PlayerHoverCard player={visibleLeader} />
                    ) : (
                      <span className="theme-text-muted">Pendiente</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-6">
                    <Link
                      className="font-semibold text-circuit hover:underline"
                      href={`/seasons/${season.id}`}
                    >
                      Ver temporada
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-5 py-6">
                    {season.status === "active" && membershipStatus !== "joined" ? (
                      <SeasonJoinButton
                        membershipStatus={membershipStatus ?? "login_required"}
                        seasonId={season.id}
                        seasonStatus={season.status}
                      />
                    ) : null}
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
