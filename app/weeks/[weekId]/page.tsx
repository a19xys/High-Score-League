import type { Metadata } from "next";
import { AccessRequired } from "@/components/auth/access-required";
import { Card, CardHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/state";
import { WeekDetailView } from "@/components/week-detail-view";
import { getServerSession } from "@/lib/auth/session";
import { getWeekDetailData } from "@/lib/data/week-detail";

export const dynamic = "force-dynamic";

type WeekDetailPageProps = {
  params: Promise<{
    weekId: string;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Leaderboard | High Score League" };
}

export default async function WeekDetailPage({ params }: WeekDetailPageProps) {
  const session = await getServerSession();

  if (session.status !== "signed-in") {
    return <AccessRequired />;
  }

  const { weekId } = await params;
  const detail = await getWeekDetailData(weekId, session.userId);

  if (!detail) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { href: "/archive#weeks", label: "Semanas" },
            { label: "Semana no disponible" },
          ]}
        />
        <Card>
          <CardHeader title="Semana no disponible" eyebrow="Semana">
            No se pudo cargar una semana real con ese id.
          </CardHeader>
          <EmptyState
            title="Detalle no disponible."
            description="La semana puede no existir o estar oculta."
          />
        </Card>
      </div>
    );
  }

  const detailLabel =
    detail.week.gameId && detail.game.title !== "Por anunciar"
      ? detail.game.title
      : `Semana ${detail.week.number}`;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { href: "/archive#weeks", label: "Semanas" },
          { label: detailLabel },
        ]}
      />
      <WeekDetailView
        benchmarks={detail.benchmarks}
        currentUserId={session.userId}
        dataMode={detail.mode}
        game={detail.game}
        hidePackImport={detail.hidePackImport}
        launcherPackId={detail.launcherPackId}
        leaderboard={detail.leaderboard}
        leaderboardPending={detail.leaderboardPending}
        season={detail.season}
        submissions={detail.submissions}
        submissionsPending={detail.submissionsPending}
        statusHelp={detail.statusHelp}
        warning={detail.warning}
        week={detail.week}
        weeklyResults={detail.weeklyResults}
      />
    </div>
  );
}
