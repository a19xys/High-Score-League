import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AccessRequired } from "@/components/auth/access-required";
import { SeasonTable } from "@/components/season-table";
import { SeasonWeeksTable } from "@/components/season-weeks-table";
import { PodiumPlaceholder } from "@/components/podium-placeholder";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SeasonJoinButton } from "@/components/season-join-button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { formatWeekCount, formatWeekRange } from "@/lib/format";
import { getSeasonDetailData } from "@/lib/data/season-detail";
import { getServerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type SeasonDetailPageProps = {
  params: Promise<{
    seasonId: string;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Clasificación | High Score League" };
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

export default async function SeasonDetailPage({ params }: SeasonDetailPageProps) {
  const session = await getServerSession();

  if (session.status !== "signed-in") {
    return <AccessRequired />;
  }

  const { seasonId } = await params;
  const seasonData = await getSeasonDetailData(seasonId, session.userId);

  if (!seasonData) {
    notFound();
  }

  const { season } = seasonData;
  const dateLabel =
    season.startsAt && season.endsAt
      ? formatWeekRange(season.startsAt, season.endsAt)
      : "Fechas pendientes";
  const showJoinCard =
    season.status === "active" && seasonData.membershipStatus !== "joined";
  const hasPodium = seasonData.standings.some(
    (standing) => standing.totalPoints > 0,
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { href: "/archive#seasons", label: "Temporadas" },
          { label: season.name },
        ]}
      />
      <Card>
        <CardHeader
          eyebrow="Detalle de temporada"
          title={season.name}
          action={<StatusBadge status={season.status} />}
        >
          {seasonStatusLabel(season.status)} · {dateLabel} · {formatWeekCount(season.weekCount)}
        </CardHeader>
        {seasonData.warning ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {seasonData.warning}
          </div>
        ) : null}
        {showJoinCard ? (
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
        ) : null}
        {seasonData.standings.length > 0 ? (
          <SeasonTable standings={seasonData.standings} />
        ) : (
          <EmptyState
            title="No hay clasificación publicada."
            description="La temporada no tiene miembros ni resultados oficiales todavía."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Semanas incluidas" eyebrow="Calendario" />
        <SeasonWeeksTable
          weeks={seasonData.weeks}
          currentWeekNumber={seasonData.currentWeekNumber}
        />
      </Card>

      {seasonData.hasRealStandings && hasPodium ? (
        <PodiumPlaceholder
          standings={seasonData.standings}
          description="Podio calculado desde resultados oficiales."
        />
      ) : null}
    </div>
  );
}
