import { notFound } from "next/navigation";
import { AccessRequired } from "@/components/auth/access-required";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { PlaceholderSection } from "@/components/ui/state";
import { hasServerSession } from "@/lib/auth/session";
import { formatScore } from "@/lib/format";
import {
  getBestScoresByWeek,
  getPlayerSubmissions,
  players,
} from "@/lib/mock-data";

const publicMedals = [
  { label: "Primer líder semanal", icon: "1", title: "Medalla mock por liderar una semana cerrada." },
  { label: "Podio en Galaga", icon: "G", title: "Medalla mock por entrar en podio de Galaga." },
  { label: "Participante fundador", icon: "F", title: "Medalla mock por participar en la primera temporada." },
];

export function generateStaticParams() {
  return players.map((player) => ({ username: player.username }));
}

type PlayerPageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function PlayerPage({ params }: PlayerPageProps) {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

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
        <div className="mb-5 flex flex-wrap items-start gap-5">
          <div className="flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold theme-surface-strong">
            {player.initials}
          </div>
          <div className="max-w-2xl">
            <p className="text-3xl font-bold theme-text">{player.initials}</p>
            <p className="theme-text-muted">@{player.username}</p>
            <p className="mt-4 leading-7 theme-text">{player.bio}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
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
              Podios oficiales
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">2</p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Participaciones
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">{bestScores.length}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Medallas públicas" eyebrow="Perfil" />
        <div className="grid gap-3 sm:grid-cols-3">
          {publicMedals.map((medal) => (
            <div
              className="rounded-lg border p-4 theme-border theme-surface-muted"
              key={medal.label}
              title={medal.title}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold theme-surface-strong">
                {medal.icon}
              </div>
              <p className="mt-3 text-sm font-semibold theme-text">{medal.label}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Historial de envíos" eyebrow="Actividad" />
        <SubmissionsTable submissions={submissions} showPlayer={false} />
      </Card>

      <PlaceholderSection
        title="Mejores resultados públicos"
        description="Más adelante se mostrarán juegos favoritos, podios y actividad por temporada."
      />
    </div>
  );
}
