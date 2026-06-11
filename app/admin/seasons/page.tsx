import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminSeasonSummaries } from "@/lib/data/admin-seasons";
import { AdminSeasonsTable } from "@/components/admin-seasons-table";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin Temporadas | High Score League",
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

export default async function AdminSeasonsPage() {
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

  const { rows, error } = await getAdminSeasonSummaries(auth.supabase);

  return (
    <div className="space-y-6">
      <ActionLink href="/profile" icon="back" variant="primary">
        Volver al perfil
      </ActionLink>
      <Card>
        <CardHeader title="Temporadas" eyebrow="Administración">
          Crea y edita temporadas reales. Las semanas se gestionan aparte y no
          se crean automáticamente.
        </CardHeader>
        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {error}
          </div>
        ) : null}
        <AdminSeasonsTable seasons={rows} />
      </Card>
    </div>
  );
}
