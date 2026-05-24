import { notFound } from "next/navigation";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { PlaceholderSection } from "@/components/ui/state";
import { formatScore } from "@/lib/format";
import {
  getBestScoresByWeek,
  getPlayerSubmissions,
  players,
} from "@/lib/mock-data";

export function generateStaticParams() {
  return players.map((player) => ({ username: player.username }));
}

type PlayerPageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { username } = await params;
  const player = players.find((candidate) => candidate.username === username);

  if (!player) {
    notFound();
  }

  const submissions = getPlayerSubmissions(player.id, 5);
  const bestScores = getBestScoresByWeek(player.id);
  const bestScore = bestScores.length
    ? Math.max(...bestScores.map((score) => score.bestScore))
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Perfil público mock" title={player.initials}>
          @{player.username}
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Mejor semanal
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {bestScore ? formatScore(bestScore) : "-"}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Envíos visibles
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">{submissions.length}</p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Podios
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">2</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Historial de envíos" eyebrow="Actividad" />
        <SubmissionsTable submissions={submissions} showPlayer={false} />
      </Card>

      <PlaceholderSection
        title="Estadísticas públicas"
        description="Más adelante se mostrarán juegos favoritos, podios y actividad por temporada."
      />
    </div>
  );
}
