import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { AccessRequired } from "@/components/auth/access-required";
import { SeasonTable } from "@/components/season-table";
import { WeeksTable } from "@/components/weeks-table";
import { PodiumPlaceholder } from "@/components/podium-placeholder";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { SeasonJoinButton } from "@/components/season-join-button";
import { formatCompactDateRange, formatWeekRange } from "@/lib/format";
import { getSeasonDetailData } from "@/lib/data/season-detail";
import { hasServerSession } from "@/lib/auth/session";
import type { WeekSummary } from "@/types";

export const dynamic = "force-dynamic";

type SeasonDetailPageProps = {
  params: Promise<{
    seasonId: string;
  }>;
};

export async function generateMetadata({
  params,
}: SeasonDetailPageProps): Promise<Metadata> {
  if (!(await hasServerSession())) {
    return { title: "Acceso privado | High Score League" };
  }

  const { seasonId } = await params;
  const seasonData = await getSeasonDetailData(seasonId);

  if (!seasonData) {
    return { title: "Clasificación | High Score League" };
  }

  return {
    title: `${seasonData.season.name} | High Score League`,
  };
}

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
    summary.week.gameId === null ||
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
        description="La temporada existe, pero todavía no tiene semanas asociadas."
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
                {secret ? "Por anunciar" : summary.game.title}
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                {secret ? (
                  <span
                    className="cursor-not-allowed font-semibold theme-text-muted"
                    title="Semana no disponible todavía."
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
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

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
          eyebrow="Detalle de temporada"
          title={season.name}
          action={
            <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
              Datos reales
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 theme-border theme-surface-muted">
          <div>
            <p className="text-sm font-semibold theme-text">Inscripción</p>
            <p className="mt-1 text-sm theme-text-muted">
              Puedes unirte a una temporada activa aunque ya haya empezado. Los
              puntos previos quedan en 0.
            </p>
          </div>
          <SeasonJoinButton
            membershipStatus={seasonData.membershipStatus}
            seasonId={season.id}
            seasonStatus={season.status}
          />
        </div>
        {seasonData.standings.length > 0 ? (
          <SeasonTable standings={seasonData.standings} />
        ) : (
          <EmptyState
            title="No hay clasificación publicada."
            description="La temporada no tiene miembros ni weekly_results oficiales todavía."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Semanas incluidas" eyebrow="Calendario" />
        <RealSeasonWeeksTable
          weeks={seasonData.weeks}
          currentWeekNumber={seasonData.currentWeekNumber}
        />
      </Card>

      {!seasonData.hasRealStandings ? (
        <EmptyState
          title="Podio pendiente."
          description="El podio real se mostrará cuando existan weekly_results oficiales."
        />
      ) : seasonData.standings.length > 0 ? (
        <PodiumPlaceholder
          standings={seasonData.standings}
          description="Podio real calculado desde weekly_results oficiales."
        />
      ) : null}
    </div>
  );
}
