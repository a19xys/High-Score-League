import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { SubmissionsTable } from "@/components/submissions-table";
import { EmptyState } from "@/components/ui/state";
import { formatExactDateTime, formatRelativeTime, formatScore } from "@/lib/format";
import type { PlayerCompetitiveProfile } from "@/lib/data/player-profile";

type ProfileHistoryProps = {
  data: PlayerCompetitiveProfile;
  mode: "owner" | "public";
  playerId: string;
  playerInitials: string;
};

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-circuit">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-2xl font-black theme-text sm:text-3xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 theme-text-muted">
        {description}
      </p>
    </div>
  );
}

function OfficialResults({ data }: { data: PlayerCompetitiveProfile }) {
  return (
    <section className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] theme-text-muted">
            Últimas jornadas
          </p>
          <h3 className="mt-1 text-xl font-black theme-text">Resultados oficiales</h3>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-bold theme-border theme-surface-muted theme-text-muted">
          {data.stats.officialResults} en total
        </span>
      </div>

      {data.recentResults.length > 0 ? (
        <ol className="divide-y theme-border">
          {data.recentResults.map((result) => (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-4"
              key={result.id}
            >
              <RankBadge rank={result.rank} />
              <div className="min-w-0">
                <Link
                  className="block truncate font-extrabold theme-text transition hover:text-circuit focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-circuit"
                  href={`/weeks/${result.week.id}`}
                >
                  Semana {result.week.number}
                  {result.game ? ` · ${result.game.title}` : ""}
                </Link>
                <p
                  className="mt-1 text-xs theme-text-muted"
                  title={formatExactDateTime(result.week.endsAt || result.createdAt)}
                >
                  {formatRelativeTime(result.week.endsAt || result.createdAt)} · {formatScore(result.leaguePoints)} pts
                </p>
              </div>
              <div className="col-start-2 text-left sm:col-start-auto sm:text-right">
                <p className="text-lg font-black theme-text">
                  {formatScore(result.finalScore)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wide theme-text-muted">
                  score final
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="Aún no hay resultados oficiales."
          description="La trayectoria empezará a tomar forma cuando se publique una jornada con este jugador."
        />
      )}
    </section>
  );
}

function BestScores({ data }: { data: PlayerCompetitiveProfile }) {
  return (
    <section className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
      <div className="mb-5">
        <p className="text-xs font-extrabold uppercase tracking-[0.12em] theme-text-muted">
          Archivo personal
        </p>
        <h3 className="mt-1 text-xl font-black theme-text">Mejores marcas</h3>
      </div>

      {data.bestScores.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {data.bestScores.slice(0, 8).map((score) => (
            <Link
              className="group relative min-w-0 overflow-hidden rounded-xl border p-4 transition theme-border theme-surface-muted hover:-translate-y-0.5 hover:border-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit motion-reduce:transform-none"
              href={`/weeks/${score.week.id}`}
              key={score.week.id}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-circuit to-sky-500"
              />
              <p className="truncate text-xs font-bold uppercase tracking-wide theme-text-muted">
                Semana {score.week.number}
              </p>
              <p className="mt-1 truncate text-sm font-extrabold theme-text">
                {score.game?.title ?? "Juego no disponible"}
              </p>
              <p className="mt-4 text-2xl font-black theme-text">
                {formatScore(score.bestScore)}
              </p>
              <p
                className="mt-1 text-xs theme-text-muted"
                title={formatExactDateTime(score.latestAt)}
              >
                {score.uploads} {score.uploads === 1 ? "envío válido" : "envíos válidos"}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Sin mejores marcas todavía."
          description="Aquí aparecerá el mejor score visible de cada semana."
        />
      )}
    </section>
  );
}

export function ProfileHistory({
  data,
  mode,
  playerId,
  playerInitials,
}: ProfileHistoryProps) {
  return (
    <section className="scroll-mt-32 space-y-5" id="trayectoria">
      <SectionHeading
        eyebrow="Trayectoria"
        title="El recorrido competitivo"
        description={
          mode === "owner"
            ? "Resultados confirmados, mejores marcas y tus envíos recientes, sin métricas estimadas."
            : "Resultados confirmados y mejores marcas que ya son visibles para toda la liga."
        }
      />

      {data.hasDataWarning ? (
        <div
          className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-text)]"
          role="status"
        >
          Parte de la trayectoria no está disponible en este momento. Los datos que sí pudieron verificarse siguen visibles.
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <OfficialResults data={data} />
        <BestScores data={data} />
      </div>

      {mode === "owner" ? (
        <section className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
          <SubmissionsTable
            currentUserId={playerId}
            currentUserInitials={playerInitials}
            emptyDescription="Tus envíos reales aparecerán aquí cuando registres actividad en una semana."
            emptyTitle="Todavía no hay envíos para este perfil."
            eyebrow="Actividad privada"
            showDetectedAt
            showPlayer={false}
            showSource
            showWeek
            submissions={data.ownerSubmissions}
            title="Tu historial de envíos"
          />
        </section>
      ) : null}
    </section>
  );
}
