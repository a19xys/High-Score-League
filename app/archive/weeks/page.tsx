import type { Metadata } from "next";
import { ArchiveLayout } from "@/components/archive/archive-layout";
import { AccessRequired } from "@/components/auth/access-required";
import { WeeksTable } from "@/components/weeks-table";
import { hasServerSession } from "@/lib/auth/session";
import { getWeekPageData } from "@/lib/data/week-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Semanas | Archivo | High Score League",
};

export default async function ArchiveWeeksPage() {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const weekData = await getWeekPageData();

  return (
    <ArchiveLayout
      activeSection="weeks"
      description="Explora las jornadas publicadas y filtra el historial semanal de la liga."
      title="Semanas"
      warning={weekData.warning}
    >
      <WeeksTable
        weeks={weekData.weeks}
        enableControls
        currentWeekNumber={weekData.currentWeekNumber}
        disableWeekLinks={weekData.disableWeekLinks}
      />
    </ArchiveLayout>
  );
}
