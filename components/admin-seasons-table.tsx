"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCompactDateRange } from "@/lib/format";
import type { AdminSeasonSummary } from "@/lib/data/admin-seasons";
import { DataTable, TableHead } from "./ui/table";
import { EmptyState } from "./ui/state";
import { StatusBadge } from "./ui/status-badge";

type AdminSeasonsTableProps = {
  seasons: AdminSeasonSummary[];
};

function matchesSearch(summary: AdminSeasonSummary, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return [summary.season.name, summary.season.slug].some((value) =>
    value.toLowerCase().includes(query),
  );
}

export function AdminSeasonsTable({ seasons }: AdminSeasonsTableProps) {
  const [search, setSearch] = useState("");
  const visibleSeasons = useMemo(
    () => seasons.filter((season) => matchesSearch(season, search)),
    [seasons, search],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="block w-full max-w-lg">
          <span className="text-sm font-semibold theme-text">Buscar temporada</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre o slug"
            value={search}
          />
        </label>
        <Link
          className="w-fit rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white"
          href="/admin/seasons/new"
        >
          Crear temporada
        </Link>
      </div>
      {visibleSeasons.length === 0 ? (
        <EmptyState
          title="No hay temporadas."
          description="Ajusta la búsqueda o crea una temporada nueva."
        />
      ) : (
        <DataTable>
          <TableHead
            labels={[
              "Nombre",
              "Slug",
              "Estado",
              "Versión",
              "Fechas",
              "Semanas",
              "Miembros",
              "",
            ]}
          />
          <tbody className="divide-y theme-border theme-surface">
            {visibleSeasons.map((summary) => (
              <tr className="theme-hover" key={summary.season.id}>
                <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                  {summary.season.name}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {summary.season.slug}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <StatusBadge status={summary.season.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {summary.season.version ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {summary.season.starts_at && summary.season.ends_at
                    ? formatCompactDateRange(
                        summary.season.starts_at,
                        summary.season.ends_at,
                      )
                    : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {summary.weekCount}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {summary.memberCount}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <Link
                    className="font-semibold text-circuit hover:underline"
                    href={`/admin/seasons/${summary.season.id}`}
                  >
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
