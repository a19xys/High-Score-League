import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminGateMessage } from "@/components/admin/admin-gate-message";
import { AdminGameForm } from "@/components/admin-game-form";
import { Card, CardHeader } from "@/components/ui/card";
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
          Edita los datos del juego. Los juegos asociados a semanas existentes
          se conservan para mantener el historial de la liga.
        </CardHeader>
        <AdminGameForm game={row} mode="edit" />
      </Card>
    </div>
  );
}
