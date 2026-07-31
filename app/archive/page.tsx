import type { Metadata } from "next";
import { ArchiveNavigation } from "@/components/archive/archive-navigation";
import { AccessRequired } from "@/components/auth/access-required";
import { SeasonsTable } from "@/components/seasons-table";
import { Card, CardHeader } from "@/components/ui/card";
import { WeeksTable } from "@/components/weeks-table";
import { parseArchiveSection } from "@/lib/archive";
import { hasServerSession } from "@/lib/auth/session";
import { getSeasonPageData } from "@/lib/data/season-page";
import { getWeekPageData } from "@/lib/data/week-page";

export const dynamic = "force-dynamic";

type ArchivePageProps = {
  searchParams: Promise<{
    section?: string | string[];
  }>;
};

export async function generateMetadata({
  searchParams,
}: ArchivePageProps): Promise<Metadata> {
  const section = parseArchiveSection((await searchParams).section);

  return {
    title:
      section === "seasons"
        ? "Temporadas | Archivo | High Score League"
        : "Semanas | Archivo | High Score League",
  };
}

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const section = parseArchiveSection((await searchParams).section);

  if (section === "seasons") {
    const seasonData = await getSeasonPageData();

    return (
      <ArchiveLayout activeSection={section}>
        <ArchiveSectionHeader
          description="Consulta las temporadas visibles de la liga, de la más nueva a la más antigua."
          title="Temporadas"
        />
        {seasonData.warning ? <ArchiveWarning>{seasonData.warning}</ArchiveWarning> : null}
        <SeasonsTable seasons={seasonData.summaries} enableControls />
      </ArchiveLayout>
    );
  }

  const weekData = await getWeekPageData();

  return (
    <ArchiveLayout activeSection={section}>
      <ArchiveSectionHeader
        description="Explora las jornadas publicadas y filtra el historial semanal de la liga."
        title="Semanas"
      />
      {weekData.warning ? <ArchiveWarning>{weekData.warning}</ArchiveWarning> : null}
      <WeeksTable
        weeks={weekData.weeks}
        enableControls
        currentWeekNumber={weekData.currentWeekNumber}
        disableWeekLinks={weekData.disableWeekLinks}
      />
    </ArchiveLayout>
  );
}

function ArchiveLayout({
  activeSection,
  children,
}: {
  activeSection: ReturnType<typeof parseArchiveSection>;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader eyebrow="Historial de la liga" title="Archivo">
        Consulta semanas y temporadas anteriores desde un único lugar.
      </CardHeader>
      <ArchiveNavigation activeSection={activeSection} />
      <div className="mt-6 space-y-4 border-t pt-6 theme-border">{children}</div>
    </Card>
  );
}

function ArchiveSectionHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold theme-text">{title}</h2>
      <p className="mt-1 text-sm leading-6 theme-text-muted">{description}</p>
    </div>
  );
}

function ArchiveWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
      {children}
    </div>
  );
}
