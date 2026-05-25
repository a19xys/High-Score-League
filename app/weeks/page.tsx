import { WeeksTable } from "@/components/weeks-table";
import { Card, CardHeader } from "@/components/ui/card";
import { getWeekPageData } from "@/lib/data/week-page";

export const dynamic = "force-dynamic";

export default async function WeeksPage() {
  const weekData = await getWeekPageData();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          eyebrow={weekData.mode === "supabase" ? "Supabase" : "Archivo semanal"}
          title="Semanas"
          action={
            <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
              {weekData.usingFallback
                ? "Fallback mock"
                : weekData.mode === "supabase"
                  ? "Datos reales"
                  : "Mock"}
            </span>
          }
        >
          Archivo semanal con filtros y ordenacion. Los detalles de semana siguen
          pendientes de conectar.
        </CardHeader>
        {weekData.warning ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {weekData.warning}
          </div>
        ) : null}
        <WeeksTable
          weeks={weekData.weeks}
          enableControls
          currentWeekNumber={weekData.currentWeekNumber}
          disableWeekLinks={weekData.disableWeekLinks}
        />
      </Card>
    </div>
  );
}
