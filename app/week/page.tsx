import { GameHero } from "@/components/game-hero";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LinkButton } from "@/components/link-button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PlaceholderSection } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatExactDateTime,
  formatRelativeTime,
  formatScore,
  formatWeekRange,
} from "@/lib/format";
import {
  currentWeek,
  getCurrentGame,
  getPlayerWeekSummary,
  getWeeklyLeaderboard,
  mockUser,
} from "@/lib/mock-data";

export default function WeekPage() {
  const game = getCurrentGame();
  const leaderboard = getWeeklyLeaderboard(currentWeek.id);
  const playerSummary = getPlayerWeekSummary(mockUser.id, currentWeek.id);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <GameHero game={game} />

        <Card>
          <CardHeader
            eyebrow={`Semana ${currentWeek.number}`}
            title={game.title}
            action={<StatusBadge status={currentWeek.status} />}
          >
            {formatWeekRange(currentWeek.startsAt, currentWeek.endsAt)}
          </CardHeader>
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold uppercase theme-text-muted">
                Reglas
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 theme-text-muted">
                {currentWeek.rules.map((rule) => (
                  <li className="flex gap-2" key={rule}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-circuit" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-3">
              <LinkButton href="/submit" variant="primary">
                Subir puntuación
              </LinkButton>
              <LinkButton href={currentWeek.manualUrl ?? "#"}>
                Descargar manual semanal
              </LinkButton>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader eyebrow="Tu estado" title={`${mockUser.initials} · Semana ${currentWeek.number}`}>
            Estado mock del jugador actual. Más adelante saldrá de Supabase Auth
            y submissions reales.
          </CardHeader>
          {playerSummary ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-4 theme-border theme-surface-muted">
                <p className="text-xs font-semibold uppercase theme-text-muted">
                  Mejor puntuación
                </p>
                <p className="mt-2 text-2xl font-bold theme-text">
                  {formatScore(playerSummary.bestScore)}
                </p>
              </div>
              <div className="rounded-lg border p-4 theme-border theme-surface-muted">
                <p className="text-xs font-semibold uppercase theme-text-muted">
                  Subidas
                </p>
                <p className="mt-2 text-2xl font-bold theme-text">
                  {playerSummary.uploads}
                </p>
              </div>
              <div className="rounded-lg border p-4 theme-border theme-surface-muted">
                <p className="text-xs font-semibold uppercase theme-text-muted">
                  Última
                </p>
                <p
                  className="mt-2 text-sm font-semibold theme-text"
                  title={formatExactDateTime(playerSummary.lastSubmission.createdAt)}
                >
                  {formatRelativeTime(playerSummary.lastSubmission.createdAt)}
                </p>
                <p className="mt-1 text-sm theme-text-muted">
                  {formatScore(playerSummary.lastSubmission.score)}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Todavía no has subido puntuaciones esta semana."
              description="Cuando envíes una puntuación válida, aquí aparecerán tu mejor marca, número de subidas y última submission."
              action={<LinkButton href="/submit">Subir puntuación</LinkButton>}
            />
          )}
        </Card>

        <PlaceholderSection
          title="Validación de captura"
          description="Esta sección se activará cuando conectemos Supabase Storage. Mostrará estado de archivo, requisitos y vista previa validada."
        />
      </section>

      <Card>
        <CardHeader title="Leaderboard semanal" eyebrow="Mejores puntuaciones" />
        <LeaderboardTable entries={leaderboard} />
      </Card>
    </div>
  );
}
