import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminSeasonDeleteButton } from "@/components/admin-season-delete-button";
import { AdminSeasonForm } from "@/components/admin-season-form";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { DataTable, TableHead } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminSeasonDetail } from "@/lib/data/admin-seasons";
import {
  formatCompactDateRange,
  formatExactDateTime,
  formatRelativeTime,
} from "@/lib/format";

export const dynamic = "force-dynamic";

type AdminSeasonPageProps = {
  params: Promise<{
    seasonId: string;
  }>;
};

function AdminGateMessage({
  title,
  description,
  showLogin,
}: {
  title: string;
  description: string | null;
  showLogin?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} eyebrow="Administración">
        {description ?? "No se pudo cargar la temporada."}
      </CardHeader>
      {showLogin ? (
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Iniciar sesión
        </Link>
      ) : null}
    </Card>
  );
}

export default async function AdminSeasonPage({ params }: AdminSeasonPageProps) {
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

  const { seasonId } = await params;
  const { data, error } = await getAdminSeasonDetail(auth.supabase, seasonId);

  if (!data) {
    if (!error) {
      notFound();
    }

    return <AdminGateMessage description={error} title="No se pudo cargar la temporada" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        <Link className="text-circuit hover:underline" href="/admin/seasons">
          ← Volver a temporadas
        </Link>
        <Link
          className="theme-text-muted hover:underline"
          href={`/seasons/${data.season.slug}`}
        >
          Ver página pública
        </Link>
        <Link
          className="theme-text-muted hover:underline"
          href={`/admin/weeks/new?seasonId=${data.season.id}`}
        >
          Crear semana para esta temporada
        </Link>
      </div>

      <Card>
        <CardHeader
          title={data.season.name}
          eyebrow="Editar temporada"
          action={<StatusBadge status={data.season.status} />}
        >
          Edita los datos principales de la temporada. El borrado solo está
          disponible para temporadas inactivas sin submissions ni resultados.
        </CardHeader>
        <AdminSeasonForm mode="edit" season={data.season} />
      </Card>

      <Card>
        <CardHeader title="Resumen" eyebrow="Temporada" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Semanas
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">{data.weekCount}</p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Miembros
            </p>
            <p className="mt-2 text-2xl font-bold theme-text">{data.memberCount}</p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">Slug</p>
            <p className="mt-2 truncate font-semibold theme-text">{data.season.slug}</p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Versión
            </p>
            <p className="mt-2 font-semibold theme-text">
              {data.season.version ?? "-"}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Semanas asociadas" eyebrow="Solo lectura" />
        {data.weeks.length === 0 ? (
          <EmptyState
            title="No hay semanas."
            description="Puedes crear la primera semana desde el enlace superior."
          />
        ) : (
          <DataTable>
            <TableHead labels={["Semana", "Estado", "Fechas", "Gestionar", "Editar"]} />
            <tbody className="divide-y theme-border theme-surface">
              {data.weeks.map((week) => (
                <tr className="theme-hover" key={week.id}>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    Semana {week.week_number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <StatusBadge status={week.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {week.public_start_at && week.final_deadline_at
                      ? formatCompactDateRange(
                          week.public_start_at,
                          week.final_deadline_at,
                        )
                      : "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <Link
                      className="font-semibold text-circuit hover:underline"
                      href={`/admin/weeks/${week.id}`}
                    >
                      Gestionar semana
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <Link
                      className="font-semibold text-circuit hover:underline"
                      href={`/admin/weeks/${week.id}/edit`}
                    >
                      Editar datos
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card>
        <CardHeader title="Miembros" eyebrow="Solo lectura" />
        {data.members.length === 0 ? (
          <EmptyState
            title="No hay miembros."
            description="Los usuarios podrán unirse cuando la temporada esté activa."
          />
        ) : (
          <DataTable>
            <TableHead labels={["Jugador", "Estado", "Unido"]} />
            <tbody className="divide-y theme-border theme-surface">
              {data.members.map((member) => (
                <tr className="theme-hover" key={member.playerId}>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                    {member.profile?.initials ?? "???"}
                    <span className="ml-2 text-xs font-normal theme-text-muted">
                      @{member.profile?.username ?? member.playerId}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                    {member.status}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 theme-text-muted"
                    title={formatExactDateTime(member.joinedAt)}
                  >
                    {formatRelativeTime(member.joinedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card>
        <CardHeader title="Zona peligrosa" eyebrow="Borrado seguro">
          Solo se pueden borrar temporadas inactivas sin submissions ni resultados.
          Al borrar una temporada también se eliminan sus semanas, benchmarks y
          membresías asociadas.
        </CardHeader>
        {data.deleteEligibility.deletable ? (
          <AdminSeasonDeleteButton
            seasonId={data.season.id}
            seasonName={data.season.name}
          />
        ) : (
          <div className="rounded-lg border p-4 text-sm theme-border theme-surface-muted theme-text-muted">
            {data.deleteEligibility.reason}
          </div>
        )}
      </Card>
    </div>
  );
}
