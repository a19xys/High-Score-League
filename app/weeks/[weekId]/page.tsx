import type { Metadata } from "next";
import { AccessRequired } from "@/components/auth/access-required";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { EmptyState } from "@/components/ui/state";
import { WeekDetailView } from "@/components/week-detail-view";
import { getServerSession, hasServerSession } from "@/lib/auth/session";
import { getWeekDetailData } from "@/lib/data/week-detail";

export const dynamic = "force-dynamic";

type WeekDetailPageProps = {
  params: Promise<{
    weekId: string;
  }>;
};

export async function generateMetadata({
  params,
}: WeekDetailPageProps): Promise<Metadata> {
  if (!(await hasServerSession())) {
    return { title: "Acceso privado | High Score League" };
  }

  const { weekId } = await params;
  const detail = await getWeekDetailData(weekId);

  if (!detail) {
    return { title: "Leaderboard | High Score League" };
  }

  return {
    title: `Leaderboard · ${detail.game.title} | High Score League`,
  };
}

export default async function WeekDetailPage({ params }: WeekDetailPageProps) {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const { weekId } = await params;
  const session = await getServerSession();
  const detail = await getWeekDetailData(weekId);

  if (!detail) {
    return (
      <div className="space-y-6">
        <ActionLink href="/weeks" icon="back" variant="primary">
          Volver a semanas
        </ActionLink>
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

  return (
    <WeekDetailView
      backHref="/weeks"
      backLabel="Volver a semanas"
      benchmarks={detail.benchmarks}
      currentUserId={session.userId}
      dataMode={detail.mode}
      game={detail.game}
      hideDownloads={detail.hideDownloads}
      leaderboard={detail.leaderboard}
      leaderboardPending={detail.leaderboardPending}
      season={detail.season}
      seasonBackHref={`/seasons/${detail.season.slug}`}
      seasonBackLabel={`Volver a ${detail.season.name}`}
      submissions={detail.submissions}
      submissionsPending={detail.submissionsPending}
      statusHelp={detail.statusHelp}
      warning={detail.warning}
      week={detail.week}
      weeklyResults={detail.weeklyResults}
    />
  );
}
