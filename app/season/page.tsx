import { SeasonTable } from "@/components/season-table";
import { Card, CardHeader } from "@/components/ui/card";
import { currentSeason, seasonStandings } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";

export default function SeasonPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Clasificacion general" title={currentSeason.name}>
          {formatDate(currentSeason.startsAt)} - {formatDate(currentSeason.endsAt)} ·{" "}
          {currentSeason.weekCount} semanas
        </CardHeader>
        <SeasonTable standings={seasonStandings} />
      </Card>
    </div>
  );
}
