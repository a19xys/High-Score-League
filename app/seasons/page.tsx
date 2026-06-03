import { SeasonsTable } from "@/components/seasons-table";
import { Card, CardHeader } from "@/components/ui/card";
import { getSeasonPageData } from "@/lib/data/season-page";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Temporadas | High Score League",
};

export default async function SeasonsPage() {
  const seasonData = await getSeasonPageData();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          eyebrow={seasonData.mode === "supabase" ? "Supabase" : "Temporadas"}
          title="Archivo de temporadas"
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
          Temporadas visibles ordenadas de mas nueva a mas antigua. Los lideres
          reales quedan pendientes hasta conectar resultados semanales.
        </CardHeader>
        {seasonData.warning ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {seasonData.warning}
          </div>
        ) : null}
        <SeasonsTable seasons={seasonData.summaries} enableControls />
      </Card>
    </div>
  );
}
