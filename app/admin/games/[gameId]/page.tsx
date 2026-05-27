import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminGameForm } from "@/components/admin-game-form";
import { Card, CardHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminGameById } from "@/lib/data/admin-games";

export const dynamic = "force-dynamic";

type AdminGamePageProps = {
  params: Promise<{
    gameId: string;
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

export default async function AdminGamePage({ params }: AdminGamePageProps) {
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

  const { gameId } = await params;
  const { row, error } = await getAdminGameById(auth.supabase, gameId);

  if (!row) {
    if (!error) {
      notFound();
    }

    return (
      <AdminGateMessage
        description={error}
        title="No se pudo cargar el juego"
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link
        className="text-sm font-semibold text-circuit hover:underline"
        href="/admin/games"
      >
        ← Volver a juegos
      </Link>
      <Card>
        <CardHeader title={row.title} eyebrow="Editar juego">
          No se permite borrar juegos en esta fase para no romper semanas
          existentes.
        </CardHeader>
        <AdminGameForm game={row} mode="edit" />
      </Card>
    </div>
  );
}
