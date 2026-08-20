import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardHeader } from "@/components/ui/card";
import {
  hasRecoveryMarker,
  isAuthorizedRecoverySession,
  RECOVERY_AUTHORIZED_COOKIE,
  RECOVERY_LOGOUT_PENDING_COOKIE,
} from "@/lib/auth/password-recovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Nueva contraseña | High Score League",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ status?: string | string[] }>;
};

const allowedStatuses = new Set([
  "invalid",
  "logout-pending",
  "mismatch",
  "policy",
  "same-password",
  "update-error",
  "weak-password",
] as const);

type ResetPasswordStatus =
  | "invalid"
  | "logout-pending"
  | "mismatch"
  | "policy"
  | "same-password"
  | "update-error"
  | "weak-password";

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const [{ status }, cookieStore, supabase] = await Promise.all([
    searchParams,
    cookies(),
    createSupabaseServerClient(),
  ]);
  const markerValue = cookieStore.get(RECOVERY_AUTHORIZED_COOKIE)?.value;
  const logoutPending = hasRecoveryMarker(
    cookieStore.get(RECOVERY_LOGOUT_PENDING_COOKIE)?.value,
  );
  const { data, error } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: new Error("unavailable") };
  const recoveryAllowed = isAuthorizedRecoverySession(
    markerValue,
    !error && Boolean(data.user),
  );
  const safeStatus =
    typeof status === "string" && allowedStatuses.has(status as ResetPasswordStatus)
      ? (status as ResetPasswordStatus)
      : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Nueva contraseña" }]} />
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader title="Nueva contraseña" eyebrow="Auth">
            Elige una contraseña nueva para tu cuenta de High Score League.
          </CardHeader>
          {recoveryAllowed ? (
            <ResetPasswordForm logoutPending={logoutPending} status={safeStatus} />
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
