import { existsSync } from "node:fs";
import { formatWeekCount, formatWeekRange } from "@/lib/format";
import { join } from "node:path";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LeagueChat } from "@/components/league-chat";
import { HomePollCard } from "@/components/home-poll-card";
import { LinkButton } from "@/components/link-button";
import { PublicLanding } from "@/components/public-landing";
import { SeasonTable } from "@/components/season-table";
import { SeasonJoinButton } from "@/components/season-join-button";
import { TopThreeSummary } from "@/components/top-three-summary";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getServerSession } from "@/lib/auth/session";
import { getHomePageData } from "@/lib/data/home";
import {
  formatCompactDateRange,
  formatLongDateWithoutYear,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function weekStatusText(status: string, statusHelp: string | null) {
  if (status === "frozen" || statusHelp?.toLowerCase().includes("tramo final")) {
    return "Tramo final";
  }

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

function weekStatusDescription(status: string, statusHelp: string | null) {
  if (status === "frozen" || statusHelp?.toLowerCase().includes("tramo final")) {
    return "Puedes seguir enviando puntuaciones, pero estas permanecerán ocultas hasta el cierre.";
  }

  if (status === "active") {
    return "La competición está abierta, por lo que puedes ir enviando puntuaciones hasta el cierre.";
  }

  if (status === "closed") {
    return "Todas las puntuaciones se han revelado, pero los resultados oficiales quedan pendientes.";
  }

  if (status === "published") {
    return "Se han publicado los resultados oficiales y la clasificación ha sido actualizada.";
  }

  return "La semana todavía no está disponible.";
}

function seasonStatusLabel(status: string) {
  if (status === "active") { return "Activa"; }
  if (status === "completed") { return "Cerrada"; }
  return "Inactiva";
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
      <HomePollCard />
	  <section className="grid items-stretch gap-6 lg:grid-cols-[1.35fr_0.85fr]">
		<div className="flex h-full min-h-[260px] flex-col justify-end rounded-lg p-7 shadow-panel theme-surface-strong">
		  <div>
			<h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
			  HIGH SCORE LEAGUE
			</h1>
			<p className="mt-4 max-w-2xl text-base leading-7 theme-text-muted">
			  Liga arcades con clasificación por temporadas y
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
		  </div>
		  {data.warning ? (
			<div className="mt-5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
			  No se pudo cargar parte de la información de la liga. Prueba a
			  recargar la página.
			</div>
		  ) : null}
		  {data.activeSeasonMessage && !season ? (
			<p className="mt-3 text-sm theme-text-muted">
			  {data.activeSeasonMessage}
			</p>
		  ) : null}
		</div>

		<Card className="flex h-full min-h-[260px] flex-col">
		  {week && game ? (
			<>
			  <CardHeader
				action={<StatusBadge status={week.status} />}
				eyebrow="Competición semanal"
				title={game.title.toUpperCase()}
			  >
				Semana {week.number} · {formatCompactDateRange(week.startsAt, week.endsAt)}
			  </CardHeader>
			  <div className="flex-1 rounded-lg border p-4 theme-border theme-surface-muted">
				<p className="text-sm font-medium theme-text-muted">
				  Estado de la semana
				</p>
				<p className="mt-2 text-2xl font-semibold theme-text">
				  {weekStatusText(week.status, data.statusHelp)}
				</p>
				<p className="mt-2 text-sm leading-6 theme-text-muted">
				  {weekStatusDescription(week.status, data.statusHelp)}
				</p>
			  </div>
			</>
		  ) : (
			<>
			  <CardHeader title="No hay semana activa" eyebrow="Competición semanal" />
			  {data.upcomingWeek ? (
				<div className="flex-1 rounded-lg border p-4 theme-border theme-surface-muted">
				  <p className="text-xs font-semibold uppercase theme-text-muted">
					Próxima semana
				  </p>
				  <p className="mt-2 text-lg font-semibold theme-text">
					Semana {data.upcomingWeek.week.number} · {data.upcomingWeek.publicLabel}
				  </p>
				  <p className="mt-2 text-sm leading-6 theme-text-muted">
					La próxima competición semanal dará comienzo el {" "}
					{formatLongDateWithoutYear(data.upcomingWeek.week.startsAt)}.
				  </p>
				</div>
			  ) : (
				<div className="flex-1 rounded-lg border border-dashed p-5 theme-border theme-surface-muted">
				  <p className="text-xs font-semibold uppercase theme-text-muted">
					Próxima semana
				  </p>
				  <p className="mt-2 text-lg font-semibold theme-text">
					Pendiente de programación
				  </p>
				  <p className="mt-2 text-sm leading-6 theme-text-muted">
					Todavía no hay una nueva competición semanal preparada. Cuando exista, su fecha de apertura se mostrará aquí.
				  </p>
				</div>
			  )}
			</>
		  )}
		</Card>
      </section>

      {season && !data.isActiveSeasonMember ? (
        <Card>
          <CardHeader
            action={<StatusBadge status={season.status} />}
            eyebrow="Temporada activa"
            title="Participa en la temporada activa"
          >
            {season.name}
          </CardHeader>
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <p className="text-sm leading-6 theme-text-muted">
              En estos momentos hay una temporada en transcurso. Para aparecer en la
              clasificación y poder sumar puntos, primero deberás unirte a ella.
            </p>
            <SeasonJoinButton
              label="Unirme a la temporada"
              membershipStatus="not_joined"
              pendingLabel="Uniéndote..."
              refreshOnSuccess={false}
              seasonId={season.id}
              seasonStatus={season.status}
              successLabel="Te has unido"
            />
          </div>
        </Card>
      ) : null}

      {week ? (
        <>
          <Card>
            <CardHeader title="Top 3 semanal" eyebrow="Resumen" />
            {topThree.length > 0 ? (
              <TopThreeSummary entries={topThree} />
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
                description="Cuando lleguen envíos visibles, el leaderboard se mostrará aquí."
              />
            )}
          </Card>
        </>
      ) : season ? (
		<Card>
		  <CardHeader
			eyebrow="Clasificación"
			title={season.name}
			action={
			  seasonHref ? (
				<LinkButton href={seasonHref}>Ver temporada</LinkButton>
			  ) : null
			}
		  >
			{seasonStatusLabel(season.status)} · {formatWeekRange(season.startsAt, season.endsAt)} · {formatWeekCount(season.weekCount)}
		  </CardHeader>

		  {data.seasonStandings.length > 0 ? (
			<SeasonTable standings={data.seasonStandings} />
		  ) : (
			<EmptyState
			  title="Todavía no hay clasificación publicada."
			  description="La clasificación aparecerá cuando se publiquen resultados oficiales."
			/>
		  )}
		</Card>
      ) : null}

      <Card>
        <CardHeader title="Chat de la liga" eyebrow="Comentarios">
          Se conservan los últimos 75 mensajes.
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
