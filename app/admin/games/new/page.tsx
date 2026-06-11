import Link from "next/link";
import type { Metadata } from "next";
import { AdminGateMessage } from "@/components/admin/admin-gate-message";
import { AdminGameForm } from "@/components/admin-game-form";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Crear juego | High Score League",
};

export default async function NewAdminGamePage() {
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

  return (
    <div className="space-y-6">
      <ActionLink href="/admin/games">
        ← Volver a juegos
      </ActionLink>
      <Card>
        <CardHeader title="Crear juego" eyebrow="Catálogo">
          Añade un juego al catálogo de la liga. Completa sus datos básicos,
          instrucciones y enlaces externos.
        </CardHeader>
        <AdminGameForm mode="create" />
      </Card>
    </div>
  );
}
