import Link from "next/link";
import { AccessRequired } from "@/components/auth/access-required";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { requireAdmin } from "@/lib/auth/admin";

export default async function AdminPage() {
  const auth = await requireAdmin();

  if (!auth.ok) {
    if (auth.status === 401) {
      return <AccessRequired />;
    }

    return (
      <Card>
        <CardHeader title="Acceso denegado" eyebrow="Administración">
          {auth.error}
        </CardHeader>
        <EmptyState
          title="No tienes permisos de administración."
          description="Esta sección está reservada para administradores de la liga."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Administración" eyebrow="Ruta legacy">
        La administración real vive en `/profile` para usuarios admin y en el
        flujo de semanas.
      </CardHeader>
      <div className="flex flex-wrap gap-3">
        <Link className="font-semibold text-circuit hover:underline" href="/profile">
          Ir al perfil
        </Link>
        <Link className="font-semibold text-circuit hover:underline" href="/admin/seasons">
          Gestionar temporadas
        </Link>
        <Link className="font-semibold text-circuit hover:underline" href="/admin/weeks">
          Gestionar semanas
        </Link>
        <Link className="font-semibold text-circuit hover:underline" href="/admin/games">
          Gestionar juegos
        </Link>
      </div>
    </Card>
  );
}
