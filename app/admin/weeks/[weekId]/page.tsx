import Link from "next/link";
import { notFound } from "next/navigation";
import {
  SubmissionValidityButton,
  WeeklyResultsActions,
} from "@/components/admin-week-actions";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { EmptyState } from "@/components/ui/state";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, TableHead } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminWeekDetail } from "@/lib/data/admin-weeks";
import {
  formatCompactDateRange,
  formatExactDateTime,
  formatRelativeTime,
  formatScore,
} from "@/lib/format";
import { RankBadge } from "@/components/rank-badge";

export const dynamic = "force-dynamic";

type AdminWeekPageProps = {
  params: Promise<{
    weekId: string;
  }>;
};

function AdminGateMessage({
  title,
  description,
  showLogin,
}: {
  title: string;
  description: string;
  showLogin?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} eyebrow="Administración">
        {description}
      </CardHeader>
      {showLogin ? (
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Iniciar sesión
        </Link>
      ) : null}
    </Card>
  );
}

export default async function AdminWeekPage({ params }: AdminWeekPageProps) {
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

  const { weekId } = await params;
  const { data, error } = await getAdminWeekDetail(auth.supabase, weekId);

  if (!data) {
    if (error === "Semana no encontrada.") {
      notFound();
    }

    return (
      <AdminGateMessage
        description={error ?? "No se pudo cargar la semana."}
        title="No se pudo cargar la semana"
      />
    );
  }

  const dateLabel =
    data.week.startsAt && data.week.endsAt
      ? formatCompactDateRange(data.week.startsAt, data.week.endsAt)
      : "Fechas pendientes";
  const weekInstructions = data.week.rules.filter((rule) => rule.trim());
  const gameInstructions = data.game.instructions?.trim() ?? "";
  const effectiveInstructions =
    weekInstructions.length > 0 ? weekInstructions.join("\n") : gameInstructions;
  const instructionSource =
    weekInstructions.length > 0
      ? "Usando instrucciones específicas de la semana"
      : gameInstructions
        ? "Usando instrucciones del juego"
        : null;
  const weekFlowNotice =
    data.week.status === "closed"
      ? "Semana cerrada. Puntuaciones reveladas. Resultados pendientes de publicar."
      : data.week.status === "published"
        ? "Resultados oficiales publicados."
        : data.week.status === "frozen"
          ? "Tramo final activo: las nuevas puntuaciones se guardan ocultas hasta el cierre."
          : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        <ActionLink href="/admin/weeks">
          ← Volver a semanas
        </ActionLink>
        <ActionLink href={`/weeks/${data.week.id}`}>
          Ver página pública
        </ActionLink>
        <Link
          className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition theme-border theme-surface theme-text theme-hover"
          href={`/admin/weeks/${data.week.id}/edit`}
        >
          Editar datos de semana
        </Link>
      </div>

      <Card>
        <CardHeader
          title={`${data.season.name} · Semana ${data.week.number}`}
          eyebrow="Administración de semana"
          action={<StatusBadge status={data.week.status} />}
        >
          {data.game.title} · {dateLabel}
        </CardHeader>
        {weekFlowNotice ? (
          <div className="mb-4 rounded-lg border p-4 text-sm theme-border theme-surface-muted theme-text-muted">
            {weekFlowNotice}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Envíos
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {data.submissionCount}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Inválidas
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {data.invalidSubmissionCount}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Benchmarks
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {data.benchmarks.length}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Resultados oficiales
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">
              {data.weeklyResults.length}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Instrucciones" eyebrow={instructionSource ?? "Sin instrucciones"} />
        {effectiveInstructions ? (
          <p className="whitespace-pre-line text-sm leading-6 theme-text-muted">
            {effectiveInstructions}
          </p>
        ) : (
          <EmptyState
            title="No hay instrucciones disponibles."
            description="Añade instrucciones base al juego o un override específico en la semana."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Resultados" eyebrow="Resultados oficiales">
          El estado se sincroniza por fechas. El cron deja la semana en closed;
          publicar resultados oficiales es una acción manual del admin.
        </CardHeader>
        <WeeklyResultsActions weekId={data.week.id} weekStatus={data.week.status} />
      </Card>

      <Card>
        <CardHeader title="Leaderboard vivo" eyebrow="Envíos visibles" />
        {data.leaderboard.length > 0 || data.benchmarks.length > 0 ? (
          <LeaderboardTable benchmarks={data.benchmarks} entries={data.leaderboard} />
        ) : (
          <EmptyState
            title="No hay leaderboard vivo."
            description="Todavía no hay envíos válidos y visibles para esta semana."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Envíos" eyebrow="Revisión admin" />
        {data.submissions.length === 0 ? (
          <EmptyState
            title="No hay envíos."
            description="Cuando lleguen envíos por ingest aparecerán aquí."
          />
        ) : (
          <DataTable>
            <TableHead
              labels={[
                "Jugador",
                "Puntuación",
                "Origen",
                "Detectada",
                "Enviada",
                "Comentario",
                "Oculta",
                "Válida",
                "Duplicado",
                "",
              ]}
            />
            <tbody className="divide-y theme-border theme-surface">
              {data.submissions.map((submission) => (
                <tr className="theme-hover" key={submission.id}>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    {submission.player?.initials ?? "???"}
                    <span className="ml-2 text-xs font-normal theme-text-muted">
                      @{submission.player?.username ?? "desconocido"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    {formatScore(submission.score)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {submission.source ?? "web"}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 text-xs theme-text-muted"
                    title={
                      submission.detectedAt
                        ? formatExactDateTime(submission.detectedAt)
                        : undefined
                    }
                  >
                    {submission.detectedAt
                      ? formatRelativeTime(submission.detectedAt)
                      : "-"}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 text-xs theme-text-muted"
                    title={formatExactDateTime(submission.createdAt)}
                  >
                    {formatRelativeTime(submission.createdAt)}
                  </td>
                  <td className="min-w-52 px-4 py-4 theme-text-muted">
                    {submission.comment ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {submission.hidden ? "Sí" : "No"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {submission.valid ? "Sí" : "No"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs theme-text-muted">
                    {submission.duplicateKey ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <SubmissionValidityButton
                      isValid={submission.valid}
                      submissionId={submission.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card>
        <CardHeader title="Resultados oficiales actuales" eyebrow="Solo lectura" />
        {data.weeklyResults.length > 0 ? (
          <DataTable>
            <TableHead labels={["Puesto", "Jugador", "Puntuación", "Puntos"]} />
            <tbody className="divide-y theme-border theme-surface">
              {data.weeklyResults.map((result) => (
                <tr className="theme-hover" key={result.id}>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    <RankBadge rank={result.rank} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    {result.player?.initials ?? "???"}
                    <span className="ml-2 text-xs font-normal theme-text-muted">
                      @{result.player?.username ?? "desconocido"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    {formatScore(result.finalScore)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {result.leaguePoints}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            title="Sin resultados oficiales."
            description="Usa Preview y Generar resultados oficiales cuando la semana esté cerrada."
          />
        )}
      </Card>
    </div>
  );
}
