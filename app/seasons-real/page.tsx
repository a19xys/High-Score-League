import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable } from "@/components/ui/table";
import { getDataSource } from "@/lib/data/data-source";
import { getRealSeasons } from "@/lib/data/seasons";
import { getRealWeeks } from "@/lib/data/weeks";
import { formatCompactDateRange } from "@/lib/format";
import { getSeasonSummaries } from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SeasonRow, WeekRow } from "@/types/supabase";

export const dynamic = "force-dynamic";

function countWeeksBySeason(weeks: WeekRow[]) {
  return weeks.reduce<Record<string, number>>((counts, week) => {
    counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    return counts;
  }, {});
}

function publicStatus(status: SeasonRow["status"]) {
  if (status === "active") {
    return "Activa";
  }

  if (status === "completed") {
    return "Cerrada";
  }

  return "Inactiva";
}

function RealSeasonsTable({
  seasons,
  weeks,
}: {
  seasons: SeasonRow[];
  weeks: WeekRow[];
}) {
  const weekCounts = countWeeksBySeason(weeks);

  if (seasons.length === 0) {
    return (
      <EmptyState
        title="No hay temporadas visibles."
        description="Ejecuta supabase/seed-dev.sql o revisa RLS si esperabas datos."
      />
    );
  }

  return (
    <DataTable>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="px-5 py-4">Temporada</th>
          <th className="px-5 py-4">Fechas</th>
          <th className="px-5 py-4">Estado</th>
          <th className="px-5 py-4">Semanas</th>
          <th className="px-5 py-4">Lider</th>
        </tr>
      </thead>
      <tbody className="divide-y theme-border">
        {seasons.map((season) => (
          <tr className="theme-hover" key={season.id}>
            <td className="px-5 py-5">
              <p className="font-semibold theme-text">{season.name}</p>
              <p className="mt-1 text-xs uppercase theme-text-muted">{season.slug}</p>
            </td>
            <td className="whitespace-nowrap px-5 py-5 theme-text-muted">
              {season.starts_at && season.ends_at
                ? formatCompactDateRange(season.starts_at, season.ends_at)
                : "-"}
            </td>
            <td className="whitespace-nowrap px-5 py-5 theme-text-muted">
              {publicStatus(season.status)}
            </td>
            <td className="whitespace-nowrap px-5 py-5 theme-text-muted">
              {weekCounts[season.id] ?? 0}
            </td>
            <td className="whitespace-nowrap px-5 py-5 theme-text-muted">
              Pendiente
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function MockNotice() {
  const summaries = getSeasonSummaries().filter(
    (summary) => summary.season.status !== "draft",
  );

  return (
    <Card>
      <CardHeader title="Temporadas reales" eyebrow="Modo mock">
        `NEXT_PUBLIC_DATA_SOURCE` no esta configurado como `supabase`. Esta ruta
        conserva el fallback y no cambia `/seasons`.
      </CardHeader>
      <div className="grid gap-3 md:grid-cols-2">
        {summaries.map(({ season }) => (
          <div
            className="rounded-lg border p-4 theme-border theme-surface-muted"
            key={season.id}
          >
            <p className="font-semibold theme-text">{season.name}</p>
            <p className="mt-1 text-sm theme-text-muted">
              {formatCompactDateRange(season.startsAt, season.endsAt)}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default async function SeasonsRealPage() {
  const dataSource = getDataSource();

  if (dataSource === "mock") {
    return <MockNotice />;
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!userData.user) {
    return (
      <Card>
        <CardHeader title="Temporadas reales" eyebrow="Supabase">
          Las politicas RLS actuales requieren sesion para leer temporadas.
        </CardHeader>
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Iniciar sesion
        </Link>
      </Card>
    );
  }

  const [seasons, weeks] = await Promise.all([
    getRealSeasons({ fallbackToMock: true }),
    getRealWeeks({ fallbackToMock: true }),
  ]);

  const visibleSeasons = seasons.rows.filter((season) => season.status !== "draft");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Temporadas reales"
          eyebrow={
            seasons.usingFallback || weeks.usingFallback
              ? "Fallback mock"
              : "Supabase"
          }
        >
          Prueba temporal de lectura real. La ruta publica `/seasons` sigue usando
          mock data.
        </CardHeader>
        {seasons.error || weeks.error ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {seasons.error ?? weeks.error}
          </div>
        ) : null}
        <RealSeasonsTable seasons={visibleSeasons} weeks={weeks.rows} />
      </Card>
    </div>
  );
}
