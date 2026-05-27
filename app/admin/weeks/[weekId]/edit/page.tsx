import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBenchmarksManager } from "@/components/admin-benchmarks-manager";
import { AdminWeekForm } from "@/components/admin-week-form";
import { Card, CardHeader } from "@/components/ui/card";
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
        <Link className="text-circuit hover:underline" href={`/admin/weeks/${weekId}`}>
          ← Volver al cuadro de mandos
        </Link>
        <Link className="theme-text-muted hover:underline" href="/admin/weeks">
          Volver a semanas
        </Link>
      </div>

      <Card>
        <CardHeader
          title={`Editar semana ${data.week.week_number}`}
          eyebrow="Datos de semana"
        >
          Edita la temporada, el juego, el estado, las fechas competitivas y las
          reglas resumidas. Las submissions y resultados oficiales se gestionan
          desde el cuadro de mandos de la semana.
        </CardHeader>
        <AdminWeekForm
          games={data.games}
          mode="edit"
          seasons={data.seasons}
          week={data.week}
        />
      </Card>

      <Card>
        <CardHeader title="Benchmarks" eyebrow="Referencias visuales">
          Los benchmarks se muestran en el leaderboard como referencias. No son
          submissions, no cuentan para puntos y no afectan a resultados oficiales.
        </CardHeader>
        <AdminBenchmarksManager benchmarks={data.benchmarks} weekId={data.week.id} />
      </Card>
    </div>
  );
}
