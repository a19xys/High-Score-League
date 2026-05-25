"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DeleteAccountButtonProps = {
  className?: string;
};

export function DeleteAccountButton({ className }: DeleteAccountButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDeleteAccount() {
    setError(null);

    const confirmation = window.prompt(
      'Esta accion borra tu cuenta de prueba. Escribe "BORRAR" para confirmar.',
    );

    if (confirmation !== "BORRAR") {
      setError("Confirmacion cancelada. No se ha borrado la cuenta.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/auth/delete-account", {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setIsSubmitting(false);
      setError(payload?.error ?? "No se pudo borrar la cuenta de prueba.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    await supabase?.auth.signOut();
    setIsSubmitting(false);
    router.refresh();
    router.push("/register");
  }

  return (
    <div className="space-y-2">
      <button
        className={
          className ??
          "rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-3 text-sm font-semibold text-[var(--warning-text)] disabled:cursor-not-allowed disabled:opacity-60"
        }
        disabled={isSubmitting}
        onClick={handleDeleteAccount}
        type="button"
      >
        {isSubmitting ? "Borrando..." : "Borrar mi cuenta de prueba"}
      </button>
      {error ? <p className="max-w-sm text-xs text-[var(--warning-text)]">{error}</p> : null}
    </div>
  );
}
