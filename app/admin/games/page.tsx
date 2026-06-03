import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminGames } from "@/lib/data/admin-games";
import { AdminGamesTable } from "@/components/admin-games-table";
import { Card, CardHeader } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin Juegos | High Score League",
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

export default async function AdminGamesPage() {
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

  const { rows, error } = await getAdminGames(auth.supabase);

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-circuit hover:underline" href="/profile">
        ← Volver al perfil
      </Link>
      <Card>
        <CardHeader title="Catálogo de juegos" eyebrow="Administración">
          Gestiona juegos reutilizables, instrucciones base y enlaces externos
          de manual. Las descargas configuradas siguen pendientes.
        </CardHeader>
        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {error}
          </div>
        ) : null}
        <AdminGamesTable games={rows} />
      </Card>
    </div>
  );
}
