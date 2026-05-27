import Link from "next/link";
import { AdminSeasonForm } from "@/components/admin-season-form";
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

export default async function NewAdminSeasonPage() {
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
        href="/admin/seasons"
      >
        ← Volver a temporadas
      </Link>
      <Card>
        <CardHeader title="Crear temporada" eyebrow="Temporadas">
          Crear una temporada no crea semanas automáticamente.
        </CardHeader>
        <AdminSeasonForm mode="create" />
      </Card>
    </div>
  );
}
