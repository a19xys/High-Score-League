import type { Metadata } from "next";
import { ArchiveLayout } from "@/components/archive/archive-layout";
import { AccessRequired } from "@/components/auth/access-required";
import { SeasonsTable } from "@/components/seasons-table";
import { hasServerSession } from "@/lib/auth/session";
import { getSeasonPageData } from "@/lib/data/season-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Temporadas | Archivo | High Score League",
};

export default async function ArchiveSeasonsPage() {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const seasonData = await getSeasonPageData();

  return (
    <ArchiveLayout
      activeSection="seasons"
      description="Consulta las temporadas visibles de la liga, de la más nueva a la más antigua."
      title="Temporadas"
      warning={seasonData.warning}
    >
      <SeasonsTable seasons={seasonData.summaries} enableControls />
    </ArchiveLayout>
  );
}
