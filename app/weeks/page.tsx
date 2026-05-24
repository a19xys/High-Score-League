import { WeeksTable } from "@/components/weeks-table";
import { Card, CardHeader } from "@/components/ui/card";
import { PlaceholderSection } from "@/components/ui/state";
import { getWeekSummaries } from "@/lib/mock-data";

export default function WeeksPage() {
  const weekSummaries = getWeekSummaries();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Archivo semanal" title="Semanas">
          Leaderboards semanales ordenados de más nueva a más antigua. Los
          detalles siguen usando datos mock.
        </CardHeader>
        <WeeksTable weeks={weekSummaries} />
      </Card>

      <PlaceholderSection
        title="Filtros de temporada"
        description="Esta sección se activará cuando conectemos Supabase para filtrar por temporada, juego y estado."
      />
    </div>
  );
}
