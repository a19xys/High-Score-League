import Link from "next/link";
import { AdminWeekForm } from "@/components/admin-week-form";
import { Card, CardHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminWeekFormOptions } from "@/lib/data/admin-weeks";

export const dynamic = "force-dynamic";

type NewAdminWeekPageProps = {
  searchParams: Promise<{
    seasonId?: string;
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

export default async function NewAdminWeekPage({
  searchParams,
}: NewAdminWeekPageProps) {
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

  const { seasonId } = await searchParams;
  const options = await getAdminWeekFormOptions(auth.supabase);

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-circuit hover:underline" href="/admin/weeks">
        ← Volver a semanas
      </Link>
      <Card>
        <CardHeader title="Crear semana" eyebrow="Semanas">
          Asocia una temporada, un juego, fechas y reglas. No se crean
          submissions ni resultados automáticamente.
        </CardHeader>
        {options.error ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {options.error}
          </div>
        ) : null}
        <AdminWeekForm
          defaultSeasonId={seasonId}
          games={options.games}
          mode="create"
          seasons={options.seasons}
        />
      </Card>
    </div>
  );
}
