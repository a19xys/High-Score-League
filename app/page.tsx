import { existsSync } from "node:fs";
import { join } from "node:path";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LeagueChat } from "@/components/league-chat";
import { LinkButton } from "@/components/link-button";
import { PublicLanding } from "@/components/public-landing";
import { getRankCardClass, RankBadge } from "@/components/rank-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getServerSession } from "@/lib/auth/session";
import { getHomePageData } from "@/lib/data/home";
import { formatCompactDateRange, formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";

function weekStatusText(status: string) {
  if (status === "active") {
    return "Competición abierta";
  }

  if (status === "closed") {
    return "Semana cerrada";
  }

  if (status === "published") {
    return "Resultados publicados";
  }

  return "Semana en preparación";
}

export default async function HomePage() {
  const session = await getServerSession();

  if (session.status !== "signed-in") {
    return (
      <PublicLanding
        hasHorizontalLogo={existsSync(
          join(process.cwd(), "public", "brand", "logo-horizontal.png"),
        )}
      />
    );
  }

  const data = await getHomePageData();
  const { season, week, game, leaderboard, benchmarks } = data;
  const topThree = leaderboard.slice(0, 3);
  const weekHref = week ? `/weeks/${week.id}` : null;
  const seasonHref = season ? `/seasons/${season.slug || season.id}` : null;

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="rounded-lg p-7 shadow-panel theme-surface-strong">
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
            HIGH SCORE LEAGUE
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">
            Liga de puntuaciones arcade con clasificación por temporadas y
            semanas temáticas
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {weekHref ? (
              <LinkButton href={weekHref} variant="primary">
                Leaderboard
              </LinkButton>
            ) : null}
            {seasonHref ? (
              <LinkButton href={seasonHref}>Clasificación</LinkButton>
            ) : null}
          </div>
          {data.warning ? (
            <div className="mt-5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
              {data.warning}
            </div>
          ) : null}
          {data.activeSeasonMessage && !season ? (
            <p className="mt-3 text-sm text-slate-200">{data.activeSeasonMessage}</p>
          ) : null}
        </div>

        <Card>
          {week && game ? (
            <>
              <CardHeader
                eyebrow="Juego activo"
                title={game.title.toUpperCase()}
                action={<StatusBadge status={week.status} />}
              >
                Semana {week.number} · {formatCompactDateRange(week.startsAt, week.endsAt)}
              </CardHeader>
              <div className="rounded-lg border p-4 theme-border theme-surface-muted">
                <p className="text-sm font-medium theme-text-muted">
                  Estado de la semana
                </p>
                <p className="mt-2 text-2xl font-semibold theme-text">
                  {weekStatusText(week.status)}
                </p>
                <p className="mt-2 text-sm leading-6 theme-text-muted">
                  Ya puedes jugar al arcade semanal e ir enviando tus puntuaciones.
                </p>
                {data.statusHelp ? (
                  <p className="mt-2 text-sm leading-6 theme-text-muted">
                    {data.statusHelp}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <CardHeader title="Sin juego activo" eyebrow="Juego activo" />
              <EmptyState
                title="No hay semana activa."
                description={
                  data.activeWeekMessage ??
                  "Espera a que se active una nueva semana para poder competir."
                }
              />
            </>
          )}
        </Card>
      </section>

      <Card>
        <CardHeader title="Top 3 semanal" eyebrow="Resumen" />
        {topThree.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {topThree.map((entry) => (
              <div
                className={`rounded-lg border p-4 ${getRankCardClass(entry.rank)}`}
                key={entry.player.id}
              >
                <RankBadge rank={entry.rank} />
                <p className="mt-3 text-xl font-bold theme-text">
                  {entry.player.initials}
                </p>
                <p className="mt-1 text-sm theme-text-muted">
                  @{entry.player.username}
                </p>
                <p className="mt-3 text-2xl font-bold theme-text">
                  {formatScore(entry.bestScore)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Todavía no hay top 3."
            description="El resumen aparecerá cuando existan envíos en la semana actual."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Leaderboard semanal" eyebrow="Competición" />
        {leaderboard.length > 0 || benchmarks.length > 0 ? (
          <LeaderboardTable benchmarks={benchmarks} entries={leaderboard} />
        ) : (
          <EmptyState
            title="Todavía no hay puntuaciones para esta semana."
            description={
              week
                ? "Cuando lleguen envíos visibles, el leaderboard se mostrará aquí."
                : "No hay semana activa desde la que construir el leaderboard."
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Chat de la liga" eyebrow="Comentarios">
          Chat global real de la liga. Se conservan los últimos 50 mensajes.
        </CardHeader>
        <LeagueChat
          canPost={data.canPostChat}
          currentUserId={data.currentUserId}
          error={data.chatError}
          messages={data.chatMessages}
        />
      </Card>
    </div>
  );
}
