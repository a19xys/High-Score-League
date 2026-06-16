import Link from "next/link";
import { AdminGateMessage } from "@/components/admin/admin-gate-message";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/admin";
import { getRealGames } from "@/lib/data/games";
import { getRealSeasonStandings } from "@/lib/data/season-standings";
import { getActiveRealSeason, getRealSeasons } from "@/lib/data/seasons";
import {
  countVisibleSubmissionsForLeaderboard,
  getRealSubmissions,
} from "@/lib/data/submissions";
import { getRealWeeklyResults } from "@/lib/data/weekly-results";
import { getCurrentRealWeek, getRealWeeks } from "@/lib/data/weeks";
import { formatCompactDateRange } from "@/lib/format";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GameRow, SeasonRow, WeekRow } from "@/types/supabase";

export const dynamic = "force-dynamic";

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
      {message}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
      {source}
    </span>
  );
}

function SeasonsRows({ seasons }: { seasons: SeasonRow[] }) {
  if (seasons.length === 0) {
    return <EmptyState title="No hay temporadas visibles." />;
  }

  return (
    <DataTable>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="px-4 py-3">Temporada</th>
          <th className="px-4 py-3">Slug</th>
          <th className="px-4 py-3">Estado</th>
          <th className="px-4 py-3">Fechas</th>
        </tr>
      </thead>
      <tbody className="divide-y theme-border">
        {seasons.map((season) => (
          <tr className="theme-hover" key={season.id}>
            <td className="px-4 py-3 font-semibold theme-text">{season.name}</td>
            <td className="px-4 py-3 theme-text-muted">{season.slug}</td>
            <td className="px-4 py-3 theme-text-muted">{season.status}</td>
            <td className="px-4 py-3 theme-text-muted">
              {season.starts_at && season.ends_at
                ? formatCompactDateRange(season.starts_at, season.ends_at)
                : "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function GamesRows({ games }: { games: GameRow[] }) {
  if (games.length === 0) {
    return <EmptyState title="No hay juegos visibles." />;
  }

  return (
    <DataTable>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="px-4 py-3">Juego</th>
          <th className="px-4 py-3">Año</th>
          <th className="px-4 py-3">Desarrollador</th>
          <th className="px-4 py-3">Género</th>
          <th className="px-4 py-3">ROM</th>
        </tr>
      </thead>
      <tbody className="divide-y theme-border">
        {games.map((game) => (
          <tr className="theme-hover" key={game.id}>
            <td className="px-4 py-3 font-semibold theme-text">{game.title}</td>
            <td className="px-4 py-3 theme-text-muted">{game.year ?? "-"}</td>
            <td className="px-4 py-3 theme-text-muted">
              {game.developers.length > 0 ? game.developers.join(" · ") : "-"}
            </td>
            <td className="px-4 py-3 theme-text-muted">
              {[...game.genres, ...game.themes, ...game.perspectives].join(" · ") || "-"}
            </td>
            <td className="px-4 py-3 theme-text-muted">{game.rom_name ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function WeeksRows({ weeks }: { weeks: WeekRow[] }) {
  if (weeks.length === 0) {
    return <EmptyState title="No hay semanas visibles." />;
  }

  return (
    <DataTable>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="px-4 py-3">Semana</th>
          <th className="px-4 py-3">Estado</th>
          <th className="px-4 py-3">Temporada</th>
          <th className="px-4 py-3">Juego</th>
          <th className="px-4 py-3">Fechas</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y theme-border">
        {weeks.map((week) => (
          <tr className="theme-hover" key={week.id}>
            <td className="px-4 py-3 font-semibold theme-text">
              Semana {week.week_number}
            </td>
            <td className="px-4 py-3 theme-text-muted">{week.status}</td>
            <td className="px-4 py-3 theme-text-muted">{week.season_id}</td>
            <td className="px-4 py-3 theme-text-muted">{week.game_id}</td>
            <td className="px-4 py-3 theme-text-muted">
              {week.public_start_at && week.final_deadline_at
                ? formatCompactDateRange(week.public_start_at, week.final_deadline_at)
                : "-"}
            </td>
            <td className="px-4 py-3">
              {week.status === "active" ||
              week.status === "closed" ||
              week.status === "published" ? (
                <Link
                  className="font-semibold text-circuit hover:underline"
                  href={`/weeks/${week.id}`}
                >
                  Abrir
                </Link>
              ) : (
                <span className="theme-text-muted">No disponible</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

export default async function RealDataTestPage() {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return (
      <AdminGateMessage
        description={auth.error}
        showLogin={auth.status === 401}
        title={auth.status === 403 ? "Acceso denegado" : "Sesión requerida"}
      />
    );
  }

  const env = getSupabaseEnv();

  if (!env.isConfigured) {
    return (
      <Card>
        <CardHeader title="Datos reales" eyebrow="Diagnostico">
          Faltan variables de Supabase para leer datos reales.
        </CardHeader>
        <EmptyState
          title="Configura .env.local"
          description={`Faltan: ${env.missing.join(", ")}.`}
        />
      </Card>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!userData.user) {
    return (
      <Card>
        <CardHeader title="Datos reales" eyebrow="Diagnostico">
          Esta pagina lee tablas protegidas por RLS. Inicia sesion para probar
          `seasons`, `games` y `weeks`.
        </CardHeader>
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Iniciar sesion
        </Link>
      </Card>
    );
  }

  const [
    seasons,
    games,
    weeks,
    currentWeek,
    activeSeason,
    submissions,
    weeklyResults,
  ] = await Promise.all([
    getRealSeasons(),
    getRealGames(),
    getRealWeeks(),
    getCurrentRealWeek(),
    getActiveRealSeason(),
    getRealSubmissions(),
    getRealWeeklyResults(),
  ]);
  const visibleSeasonIds = new Set(
    seasons.rows
      .filter((season) => season.status !== "draft")
      .map((season) => season.id),
  );
  const visibleWeeks = weeks.rows.filter((week) => visibleSeasonIds.has(week.season_id));
  const hiddenDraftWeeks = weeks.rows.length - visibleWeeks.length;
  const activeSeasonWeeks = activeSeason
    ? weeks.rows.filter((week) => week.season_id === activeSeason.id)
    : [];
  const activeSeasonStandings = activeSeason
    ? await getRealSeasonStandings(activeSeason.id)
    : null;
  const currentWeekVisibleSubmissions = currentWeek
    ? countVisibleSubmissionsForLeaderboard(
        submissions.rows.filter((submission) => submission.week_id === currentWeek.id),
        currentWeek.status,
      )
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Datos reales"
          eyebrow="Diagnostico"
          action={<SourceBadge source="supabase" />}
        >
          Lectura de dominio aislada. Las rutas principales leen datos reales
          de Supabase y los diagnósticos ayudan a revisar RLS y contenido.
        </CardHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Temporada activa
            </p>
            <p className="mt-2 font-semibold theme-text">
              {activeSeason?.name ?? "No detectada"}
            </p>
            {activeSeason ? (
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link
                  className="font-semibold text-circuit hover:underline"
                  href={`/seasons/${activeSeason.slug}`}
                >
                  Abrir por slug
                </Link>
                <Link
                  className="font-semibold text-circuit hover:underline"
                  href={`/seasons/${activeSeason.id}`}
                >
                  Abrir por id
                </Link>
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Semana actual
            </p>
            <p className="mt-2 font-semibold theme-text">
              {currentWeek ? `Semana ${currentWeek.week_number}` : "No detectada"}
            </p>
            <p className="mt-1 text-sm theme-text-muted">
              {visibleWeeks.length} visibles · {hiddenDraftWeeks} ocultas por draft
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link className="font-semibold text-circuit hover:underline" href="/weeks">
                Abrir archivo semanal
              </Link>
              <Link className="font-semibold text-circuit hover:underline" href="/game">
                Abrir juego actual
              </Link>
              {currentWeek ? (
                <Link
                  className="font-semibold text-circuit hover:underline"
                  href={`/weeks/${currentWeek.id}`}
                >
                  Abrir semana activa
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Submissions reales
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {submissions.rows.length}
            </p>
            {submissions.error ? (
              <p className="mt-2 text-xs text-[var(--warning-text)]">
                {submissions.error}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Visibles semana actual
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {currentWeekVisibleSubmissions}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              weekly_results
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {weeklyResults.rows.length}
            </p>
            {weeklyResults.error ? (
              <p className="mt-2 text-xs text-[var(--warning-text)]">
                {weeklyResults.error}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Clasificacion activa
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {activeSeasonStandings?.rows.length ?? 0}
            </p>
            <p className="mt-1 text-xs theme-text-muted">
              {activeSeasonStandings
                ? `${activeSeasonStandings.officialResultCount} resultados oficiales`
                : "Sin temporada activa"}
            </p>
            {activeSeasonStandings?.error ? (
              <p className="mt-2 text-xs text-[var(--warning-text)]">
                {activeSeasonStandings.error}
              </p>
            ) : null}
          </div>
        </div>
        {activeSeason ? (
          <p className="mt-4 text-sm theme-text-muted">
            Semanas de la temporada activa: {activeSeasonWeeks.length}.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Seasons"
          eyebrow={`${seasons.rows.length} filas`}
          action={
            <SourceBadge source={seasons.source} />
          }
        />
        {seasons.error ? <ErrorNotice message={seasons.error} /> : null}
        <SeasonsRows seasons={seasons.rows} />
      </Card>

      <Card>
        <CardHeader
          title="Games"
          eyebrow={`${games.rows.length} filas`}
          action={
            <SourceBadge source={games.source} />
          }
        />
        {games.error ? <ErrorNotice message={games.error} /> : null}
        <GamesRows games={games.rows} />
      </Card>

      <Card>
        <CardHeader
          title="Weeks"
          eyebrow={`${weeks.rows.length} filas`}
          action={
            <SourceBadge source={weeks.source} />
          }
        />
        {weeks.error ? <ErrorNotice message={weeks.error} /> : null}
        <WeeksRows weeks={weeks.rows} />
      </Card>
    </div>
  );
}
