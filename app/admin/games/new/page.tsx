import Link from "next/link";
import { AdminGameForm } from "@/components/admin-game-form";
import { Card, CardHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

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
      <Link
        className="text-sm font-semibold text-circuit hover:underline"
        href="/admin/games"
      >
        ← Volver a juegos
      </Link>
      <Card>
        <CardHeader title="Crear juego" eyebrow="Catálogo">
          image_url y manual_url son texto por ahora. No hay Storage ni subida
          de imágenes o manuales.
        </CardHeader>
        <AdminGameForm mode="create" />
      </Card>
    </div>
  );
}
