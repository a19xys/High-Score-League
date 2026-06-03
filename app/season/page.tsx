import { AccessRequired } from "@/components/auth/access-required";
import { SeasonTable } from "@/components/season-table";
import { Card, CardHeader } from "@/components/ui/card";
import { hasServerSession } from "@/lib/auth/session";
import { currentSeason, seasonStandings } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";

export default async function SeasonPage() {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Clasificación general" title={currentSeason.name}>
          {formatDate(currentSeason.startsAt)} - {formatDate(currentSeason.endsAt)} ·{" "}
          {currentSeason.weekCount} semanas
        </CardHeader>
        <SeasonTable standings={seasonStandings} />
      </Card>
    </div>
  );
}
