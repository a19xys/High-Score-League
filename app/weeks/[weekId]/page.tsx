import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { WeekDetailView } from "@/components/week-detail-view";
import { getDataSource } from "@/lib/data/data-source";
import { getMockWeekStaticParams, getWeekDetailData } from "@/lib/data/week-detail";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return getMockWeekStaticParams();
}

type WeekDetailPageProps = {
  params: Promise<{
    weekId: string;
  }>;
};

export default async function WeekDetailPage({ params }: WeekDetailPageProps) {
  const { weekId } = await params;
  const detail = await getWeekDetailData(weekId);

  if (!detail) {
    if (getDataSource() === "supabase") {
      return (
        <div className="space-y-6">
          <Link className="text-sm font-semibold text-circuit hover:underline" href="/weeks">
            ← Volver a semanas
          </Link>
          <Card>
            <CardHeader title="Semana no disponible" eyebrow="Supabase">
              No se pudo cargar una semana real con ese id. Si RLS bloquea la
              lectura, inicia sesión y vuelve a intentarlo.
            </CardHeader>
            <EmptyState
              title="Detalle no disponible."
              description="La semana puede no existir, estar oculta o requerir sesión."
            />
          </Card>
        </div>
      );
    }

    notFound();
  }

  return (
    <WeekDetailView
      backHref="/weeks"
      backLabel="← Volver a semanas"
      benchmarks={detail.benchmarks}
      dataMode={detail.mode}
      game={detail.game}
      hideDownloads={detail.hideDownloads}
      leaderboard={detail.leaderboard}
      leaderboardPending={detail.leaderboardPending}
      season={detail.season}
      seasonBackHref={`/seasons/${detail.season.slug}`}
      seasonBackLabel={`← Volver a ${detail.season.name}`}
      submissions={detail.submissions}
      submissionsPending={detail.submissionsPending}
      statusHelp={detail.statusHelp}
      warning={detail.warning}
      week={detail.week}
      weeklyResults={detail.weeklyResults}
    />
  );
}
