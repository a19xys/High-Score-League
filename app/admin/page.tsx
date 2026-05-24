import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatScore } from "@/lib/format";
import { currentWeek, getCurrentGame, getRecentSubmissions } from "@/lib/mock-data";

const stateActions = ["Activar", "Congelar", "Cerrar", "Publicar"];

export default function AdminPage() {
  const game = getCurrentGame();
  const recentSubmissions = getRecentSubmissions();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          eyebrow="Administración provisional"
          title={`Semana ${currentWeek.number} · ${game.title}`}
          action={<StatusBadge status={currentWeek.status} />}
        >
          Esta ruta se mantiene temporalmente sin enlazar. La administración
          vivirá dentro de Perfil cuando exista autenticación real.
        </CardHeader>

        <div className="grid gap-3 sm:grid-cols-4">
          {stateActions.map((action) => (
            <button
              className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface theme-hover"
              key={action}
              type="button"
            >
              {action}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Últimas puntuaciones" eyebrow="Moderación mock" />
        <div className="divide-y theme-border">
          {recentSubmissions.map((submission) => (
            <div
              className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
              key={submission.id}
            >
              <div>
                <p className="font-semibold theme-text">
                  {submission.player?.initials ?? "???"}
                </p>
                <p className="text-sm theme-text-muted">
                  @{submission.player?.username ?? "desconocido"} ·{" "}
                  {formatDateTime(submission.createdAt)} ·{" "}
                  {submission.valid ? "Válida" : "Pendiente"}
                </p>
              </div>
              <p className="text-lg font-bold theme-text">
                {formatScore(submission.score)}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
