import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBenchmarksManager } from "@/components/admin-benchmarks-manager";
import { AdminWeekDeleteButton } from "@/components/admin-week-delete-button";
import { AdminWeekForm } from "@/components/admin-week-form";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminWeekEditData } from "@/lib/data/admin-weeks";

export const dynamic = "force-dynamic";

type EditAdminWeekPageProps = {
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

export default async function EditAdminWeekPage({
  params,
}: EditAdminWeekPageProps) {
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
  const { data, error } = await getAdminWeekEditData(auth.supabase, weekId);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        <ActionLink href={`/admin/weeks/${weekId}`} icon="back" variant="primary">
          Volver al cuadro de mandos
        </ActionLink>
        <ActionLink href="/admin/weeks" icon="back">
          Volver a semanas
        </ActionLink>
      </div>

      <Card>
        <CardHeader
          title={`Editar semana ${data.week.week_number}`}
          eyebrow="Datos de semana"
        >
          Edita la temporada, el juego, apertura, tramo final, cierre e
          instrucciones específicas. Los envíos y resultados oficiales se
          gestionan desde el cuadro de mandos de la semana.
        </CardHeader>
        <AdminWeekForm
          games={data.games}
          mode="edit"
          seasons={data.seasons}
          week={data.week}
          weeks={data.weeks}
        />
      </Card>

      <Card>
        <CardHeader title="Benchmarks" eyebrow="Referencias visuales">
          Los benchmarks se muestran en el leaderboard como referencias. No son
          envíos, no cuentan para puntos y no afectan a resultados oficiales.
        </CardHeader>
        <AdminBenchmarksManager benchmarks={data.benchmarks} weekId={data.week.id} />
      </Card>

      <Card>
        <CardHeader title="Zona peligrosa" eyebrow="Borrado seguro">
          Solo se pueden borrar semanas inactivas sin envíos ni resultados.
          Al borrar una semana también se eliminan sus benchmarks y se renumeran
          las semanas restantes de la temporada.
        </CardHeader>
        {data.deleteEligibility.deletable ? (
          <AdminWeekDeleteButton weekId={data.week.id} />
        ) : (
          <div className="rounded-lg border p-4 text-sm theme-border theme-surface-muted theme-text-muted">
            {data.deleteEligibility.reason}
          </div>
        )}
      </Card>
    </div>
  );
}
