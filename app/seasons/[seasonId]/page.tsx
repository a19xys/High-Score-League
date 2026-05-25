import { notFound } from "next/navigation";
import Link from "next/link";
import { SeasonTable } from "@/components/season-table";
import { WeeksTable } from "@/components/weeks-table";
import { PodiumPlaceholder } from "@/components/podium-placeholder";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCompactDateRange, formatWeekRange } from "@/lib/format";
import { getSeasonDetailData } from "@/lib/data/season-detail";
import { seasons } from "@/lib/mock-data";
import type { WeekSummary } from "@/types";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return seasons
    .filter((season) => season.status !== "draft")
    .flatMap((season) => [{ seasonId: season.id }, { seasonId: season.slug }]);
}

type SeasonDetailPageProps = {
  params: Promise<{
    seasonId: string;
  }>;
};

function seasonStatusLabel(status: string) {
  if (status === "active") {
    return "Activa";
  }

  if (status === "completed") {
    return "Cerrada";
  }

  return "Inactiva";
}

function isSecretWeek(summary: WeekSummary, currentWeekNumber?: number) {
  return (
    summary.week.status === "draft" ||
    summary.game.title.trim().toLowerCase() === "juego secreto" ||
    (summary.season.status === "active" &&
      typeof currentWeekNumber === "number" &&
      summary.week.number > currentWeekNumber &&
      summary.week.status !== "published")
  );
}

function RealSeasonWeeksTable({
  weeks,
  currentWeekNumber,
}: {
  weeks: WeekSummary[];
  currentWeekNumber?: number;
}) {
  if (weeks.length === 0) {
    return (
      <EmptyState
        title="No hay semanas visibles."
        description="La temporada real existe, pero todavia no tiene semanas asociadas."
      />
    );
  }

  return (
    <DataTable>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="px-4 py-3">Semana</th>
          <th className="px-4 py-3">Fechas</th>
          <th className="px-4 py-3">Estado</th>
          <th className="px-4 py-3">Juego</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y theme-border theme-surface">
        {weeks.map((summary) => {
          const hasDates = summary.week.startsAt && summary.week.endsAt;
          const secret = isSecretWeek(summary, currentWeekNumber);

          return (
            <tr className="theme-hover" key={summary.week.id}>
              <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                Semana {summary.week.number}
              </td>
              <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                {hasDates
                  ? formatCompactDateRange(summary.week.startsAt, summary.week.endsAt)
                  : "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <StatusBadge status={summary.week.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-4 theme-text">
                {secret ? "Juego secreto" : summary.game.title}
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                {secret ? (
                  <span
                    className="cursor-not-allowed font-semibold theme-text-muted"
                    title="Semana no disponible todavia."
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
  );
}

export default async function SeasonDetailPage({ params }: SeasonDetailPageProps) {
  const { seasonId } = await params;
  const seasonData = await getSeasonDetailData(seasonId);

  if (!seasonData) {
    notFound();
  }

  const { season } = seasonData;
  const dateLabel =
    season.startsAt && season.endsAt
      ? formatWeekRange(season.startsAt, season.endsAt)
      : "Fechas pendientes";

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-circuit hover:underline" href="/seasons">
        ← Volver a temporadas
      </Link>
      <Card>
        <CardHeader
          eyebrow={seasonData.mode === "supabase" ? "Supabase" : "Detalle de temporada"}
          title={season.name}
          action={
            <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
              {seasonData.usingFallback
                ? "Fallback mock"
                : seasonData.mode === "supabase"
                  ? "Datos reales"
                  : "Mock"}
            </span>
          }
        >
          {seasonStatusLabel(season.status)} · {dateLabel} · {season.weekCount} semanas
        </CardHeader>
        {seasonData.warning ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {seasonData.warning}
          </div>
        ) : null}
        {seasonData.mode === "supabase" ? (
          <EmptyState
            title="Clasificacion pendiente."
            description="Los datos reales de clasificacion se conectaran cuando existan weekly_results publicados."
          />
        ) : seasonData.standings.length > 0 ? (
          <SeasonTable standings={seasonData.standings} />
        ) : (
          <EmptyState
            title="No hay clasificacion publicada."
            description="Esta temporada todavia no tiene resultados mock asociados."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Semanas incluidas" eyebrow="Calendario" />
        {seasonData.mode === "supabase" ? (
          <RealSeasonWeeksTable
            weeks={seasonData.weeks}
            currentWeekNumber={seasonData.currentWeekNumber}
          />
        ) : (
          <WeeksTable
            weeks={seasonData.weeks}
            currentWeekNumber={seasonData.currentWeekNumber}
          />
        )}
      </Card>

      {seasonData.mode === "supabase" ? (
        <EmptyState
          title="Podio pendiente."
          description="El podio real se mostrara cuando conectemos resultados oficiales."
        />
      ) : seasonData.standings.length > 0 ? (
        <PodiumPlaceholder />
      ) : null}
    </div>
  );
}
