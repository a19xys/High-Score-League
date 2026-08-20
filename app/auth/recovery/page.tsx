import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { RecoveryActions } from "@/components/auth/recovery-actions";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardHeader } from "@/components/ui/card";
import {
  isStructurallyValidRecoveryToken,
  RECOVERY_STAGING_COOKIE,
} from "@/lib/auth/password-recovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Verificar recuperación | High Score League",
};

export default async function RecoveryPage() {
  const cookieStore = await cookies();
  const hasStagedRecovery = isStructurallyValidRecoveryToken(
    cookieStore.get(RECOVERY_STAGING_COOKIE)?.value,
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Verificar recuperación" }]} />
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader title="Recuperar contraseña" eyebrow="Auth">
            Verifica el enlace antes de elegir una contraseña nueva.
          </CardHeader>
          {hasStagedRecovery ? (
            <div className="space-y-4">
              <p className="text-sm theme-text">
                Hemos recibido una solicitud para cambiar la contraseña.
              </p>
              <p className="text-sm theme-text-muted">
                Pulsa Continuar para verificar el enlace de forma segura.
              </p>
              <RecoveryActions />
            </div>
          ) : (
            <div className="space-y-4">
              <p
                className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]"
                role="alert"
              >
                Este enlace de recuperación ya no es válido. Solicita uno nuevo.
              </p>
              <Link
                className="inline-flex rounded font-semibold text-circuit hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
                href="/forgot-password"
              >
                Solicitar un nuevo enlace
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
