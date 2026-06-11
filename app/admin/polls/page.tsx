import type { Metadata } from "next";
import { AdminGateMessage } from "@/components/admin/admin-gate-message";
import { AdminHomePollForm } from "@/components/admin-home-poll-form";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionLink } from "@/components/ui/action-link";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminHomePoll } from "@/lib/data/admin-polls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin Cuestionarios | High Score League",
};

export default async function AdminPollsPage() {
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

  const result = await getAdminHomePoll(auth.supabase);

  return (
    <div className="space-y-6">
      <ActionLink href="/profile" icon="back" variant="primary">
        Volver al perfil
      </ActionLink>
      <Card>
        <CardHeader title="Cuestionarios" eyebrow="Administración">
          Gestiona el cuestionario que puede aparecer en Home para usuarios
          registrados.
        </CardHeader>
        {result.error || !result.data ? (
          <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
            {result.error ?? "No se pudo cargar el cuestionario."}
          </div>
        ) : (
          <AdminHomePollForm initialData={result.data} />
        )}
      </Card>
    </div>
  );
}
