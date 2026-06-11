import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminWeekSummaries } from "@/lib/data/admin-weeks";
import { formatCompactDateRange } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { EmptyState } from "@/components/ui/state";
import { DataTable, TableHead } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin Semanas | High Score League",
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

export default async function AdminWeeksPage() {
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

  const { rows, error } = await getAdminWeekSummaries(auth.supabase);

  return (
    <div className="space-y-6">
      <ActionLink href="/profile">
        ← Volver al perfil
      </ActionLink>
      <Card>
        <CardHeader title="Semanas" eyebrow="Administración">
          Gestión mínima del flujo semanal: estado, envíos y resultados
          oficiales.
        </CardHeader>
        <div className="mb-4">
          <Link
            className="inline-flex rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white"
            href="/admin/weeks/new"
          >
            Crear semana
          </Link>
        </div>
        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {error}
          </div>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState
            title="No hay semanas reales."
            description="Crea semanas en Supabase para poder gestionarlas aquí."
          />
        ) : (
          <DataTable>
            <TableHead
              labels={[
                "Temporada",
                "Semana",
                "Juego",
                "Estado",
                "Fechas",
                "Envíos",
                "Inválidas",
                "Resultados",
                "",
              ]}
            />
            <tbody className="divide-y theme-border theme-surface">
              {rows.map((summary) => (
                <tr className="theme-hover" key={summary.week.id}>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    {summary.season.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    Semana {summary.week.number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text">
                    {summary.game.title}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <StatusBadge status={summary.week.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {summary.week.startsAt && summary.week.endsAt
                      ? formatCompactDateRange(
                          summary.week.startsAt,
                          summary.week.endsAt,
                        )
                      : "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {summary.submissionCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {summary.invalidSubmissionCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {summary.hasWeeklyResults ? "Sí" : "No"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <Link
                      className="font-semibold text-circuit hover:underline"
                      href={`/admin/weeks/${summary.week.id}`}
                    >
                      Gestionar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
