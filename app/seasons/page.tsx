import { SeasonsTable } from "@/components/seasons-table";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { getSeasonSummaries } from "@/lib/mock-data";

export default function SeasonsPage() {
  const seasonSummaries = getSeasonSummaries();
  const closedSeasons = seasonSummaries.filter(
    (summary) => summary.season.status === "completed",
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Temporadas" title="Archivo de temporadas">
          Temporadas ordenadas de más nueva a más antigua, con estado y líder o
          campeón mock.
        </CardHeader>
        <SeasonsTable seasons={seasonSummaries} />
      </Card>

      {closedSeasons.length === 0 ? (
        <EmptyState
          title="No hay temporadas cerradas."
          description="Cuando una temporada se publique como cerrada, aparecerá aquí con su campeón."
        />
      ) : null}
    </div>
  );
}
