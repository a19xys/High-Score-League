import { SeasonsTable } from "@/components/seasons-table";
import { Card, CardHeader } from "@/components/ui/card";
import { getSeasonSummaries } from "@/lib/mock-data";

export default function SeasonsPage() {
  const seasonSummaries = getSeasonSummaries().filter(
    (summary) => summary.season.status !== "draft",
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Temporadas" title="Archivo de temporadas">
          Temporadas visibles ordenadas de más nueva a más antigua, con estado y
          líder mock.
        </CardHeader>
        <SeasonsTable seasons={seasonSummaries} enableControls />
      </Card>
    </div>
  );
}
