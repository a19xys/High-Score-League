import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { ArchiveSectionSwitcher } from "@/components/archive/archive-section-switcher";
import { AccessRequired } from "@/components/auth/access-required";
import { SeasonsTable } from "@/components/seasons-table";
import { WeeksTable } from "@/components/weeks-table";
import { hasServerSession } from "@/lib/auth/session";
import { getArchivePath } from "@/lib/archive";
import { getSeasonPageData } from "@/lib/data/season-page";
import { getWeekPageData } from "@/lib/data/week-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Archivo | High Score League",
};

type ArchivePageProps = {
  searchParams: Promise<{
    section?: string | string[];
  }>;
};

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const { section } = await searchParams;

  if (section !== undefined) {
    permanentRedirect(getArchivePath(section));
  }

  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const [weekData, seasonData] = await Promise.all([
    getWeekPageData(),
    getSeasonPageData(),
  ]);

  return (
    <ArchiveSectionSwitcher
      panels={[
        {
          id: "weeks",
          label: "Semanas",
          description:
            "Explora las jornadas publicadas y filtra el historial semanal de la liga.",
          warning: weekData.warning,
          panel: (
            <WeeksTable
              weeks={weekData.weeks}
              enableControls
              currentWeekNumber={weekData.currentWeekNumber}
              disableWeekLinks={weekData.disableWeekLinks}
            />
          ),
        },
        {
          id: "seasons",
          label: "Temporadas",
          description:
            "Consulta las temporadas visibles de la liga, de la más nueva a la más antigua.",
          warning: seasonData.warning,
          panel: <SeasonsTable seasons={seasonData.summaries} enableControls />,
        },
      ]}
    />
  );
}
