import { notFound } from "next/navigation";
import Link from "next/link";
import { SeasonTable } from "@/components/season-table";
import { WeeksTable } from "@/components/weeks-table";
import { PodiumPlaceholder } from "@/components/podium-placeholder";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { formatWeekRange } from "@/lib/format";
import {
  getSeasonById,
  getSeasonWeeks,
  currentWeek,
  seasonStandings,
  seasons,
} from "@/lib/mock-data";

export function generateStaticParams() {
  return seasons
    .filter((season) => season.status !== "draft")
    .map((season) => ({ seasonId: season.id }));
}

type SeasonDetailPageProps = {
  params: Promise<{
    seasonId: string;
  }>;
};

export default async function SeasonDetailPage({ params }: SeasonDetailPageProps) {
  const { seasonId } = await params;
  const season = getSeasonById(seasonId);

  if (!season || season.status === "draft") {
    notFound();
  }

  const seasonWeeks = getSeasonWeeks(season.id);
  const hasStandings = season.id === "s1";

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-circuit hover:underline" href="/seasons">
        ← Volver a temporadas
      </Link>
      <Card>
        <CardHeader eyebrow="Detalle de temporada" title={season.name}>
          {season.version ?? "Sin versión"} · {formatWeekRange(season.startsAt, season.endsAt)}
        </CardHeader>
        {hasStandings ? (
          <SeasonTable standings={seasonStandings} />
        ) : (
          <EmptyState
            title="No hay clasificación publicada."
            description="Esta temporada todavía no tiene resultados mock asociados."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Semanas incluidas" eyebrow="Calendario" />
        <WeeksTable weeks={seasonWeeks} currentWeekNumber={currentWeek.number} />
      </Card>

      <PodiumPlaceholder />
    </div>
  );
}
