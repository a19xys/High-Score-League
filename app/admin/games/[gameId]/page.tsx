import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminGateMessage } from "@/components/admin/admin-gate-message";
import { AdminGameForm } from "@/components/admin-game-form";
import { AdminGameDeleteButton } from "@/components/admin-game-delete-button";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminGameById } from "@/lib/data/admin-games";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Editar juego | High Score League",
};

type AdminGamePageProps = {
  params: Promise<{
    gameId: string;
  }>;
};

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
  const { row, usageCount, error } = await getAdminGameById(auth.supabase, gameId);

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
      <ActionLink href="/admin/games" icon="back" variant="primary">
        Volver a juegos
      </ActionLink>
      <Card>
        <CardHeader title={row.title} eyebrow="Editar juego">
          Edita los datos del juego. Los juegos asociados a semanas existentes
          se conservan para mantener el historial de la liga.
        </CardHeader>
        <AdminGameForm game={row} mode="edit" />
      </Card>
      <Card>
        <CardHeader title="Zona peligrosa" eyebrow="Borrado seguro">
          {usageCount > 0
            ? `Este juego está protegido porque aparece en ${usageCount} semanas.`
            : "Este juego no está asociado a ninguna semana."}
        </CardHeader>
        <AdminGameDeleteButton
          disabled={usageCount > 0}
          gameId={row.id}
          gameTitle={row.title}
        />
      </Card>
    </div>
  );
}
