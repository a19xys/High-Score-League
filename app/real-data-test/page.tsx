import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable } from "@/components/ui/table";
import { getRealGames } from "@/lib/data/games";
import { getActiveRealSeason, getRealSeasons } from "@/lib/data/seasons";
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

function SourceBadge({
  source,
  usingFallback,
}: {
  source: string;
  usingFallback: boolean;
}) {
  return (
    <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
      {usingFallback ? "Fallback mock" : source}
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
          <th className="px-4 py-3">ROM</th>
        </tr>
      </thead>
      <tbody className="divide-y theme-border">
        {games.map((game) => (
          <tr className="theme-hover" key={game.id}>
            <td className="px-4 py-3 font-semibold theme-text">{game.title}</td>
            <td className="px-4 py-3 theme-text-muted">{game.year ?? "-"}</td>
            <td className="px-4 py-3 theme-text-muted">{game.developer ?? "-"}</td>
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
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

export default async function RealDataTestPage() {
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

  const [seasons, games, weeks, currentWeek, activeSeason] = await Promise.all([
    getRealSeasons(),
    getRealGames(),
    getRealWeeks(),
    getCurrentRealWeek(),
    getActiveRealSeason(),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Datos reales"
          eyebrow="Diagnostico"
          action={<SourceBadge source="supabase" usingFallback={false} />}
        >
          Lectura de dominio aislada. No sustituye todavia el mockup principal.
        </CardHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Temporada activa
            </p>
            <p className="mt-2 font-semibold theme-text">
              {activeSeason?.name ?? "No detectada"}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Semana actual
            </p>
            <p className="mt-2 font-semibold theme-text">
              {currentWeek ? `Semana ${currentWeek.week_number}` : "No detectada"}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Seasons"
          eyebrow={`${seasons.rows.length} filas`}
          action={
            <SourceBadge
              source={seasons.source}
              usingFallback={seasons.usingFallback}
            />
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
            <SourceBadge source={games.source} usingFallback={games.usingFallback} />
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
            <SourceBadge source={weeks.source} usingFallback={weeks.usingFallback} />
          }
        />
        {weeks.error ? <ErrorNotice message={weeks.error} /> : null}
        <WeeksRows weeks={weeks.rows} />
      </Card>
    </div>
  );
}
