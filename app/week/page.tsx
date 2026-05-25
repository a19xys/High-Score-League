import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { WeekDetailView } from "@/components/week-detail-view";
import { getActiveWeekDetailData } from "@/lib/data/week-detail";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const result = await getActiveWeekDetailData();

  if (result.status === "empty") {
    return (
      <Card>
        <CardHeader title="Juego actual" eyebrow="Semana activa">
          {result.warning ?? "No se pudo detectar una semana activa real."}
        </CardHeader>
        <EmptyState
          title="No hay semana activa."
          description={result.message}
        />
      </Card>
    );
  }

  const detail = result.data;

  return (
    <WeekDetailView
      dataMode={detail.mode}
      game={detail.game}
      hideDownloads={detail.hideDownloads}
      leaderboard={detail.leaderboard}
      leaderboardPending={detail.leaderboardPending}
      season={detail.season}
      submissions={detail.submissions}
      submissionsPending={detail.submissionsPending}
      warning={detail.warning}
      week={detail.week}
    />
  );
}
