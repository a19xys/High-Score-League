import { AccessRequired } from "@/components/auth/access-required";
import { SeasonsTable } from "@/components/seasons-table";
import { Card, CardHeader } from "@/components/ui/card";
import { hasServerSession } from "@/lib/auth/session";
import { getSeasonPageData } from "@/lib/data/season-page";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Temporadas | High Score League",
};

export default async function SeasonsPage() {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const seasonData = await getSeasonPageData();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          eyebrow="Temporadas"
          title="Archivo de temporadas"
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
