"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type LogoutButtonProps = {
  className?: string;
};

export function LogoutButton({ className }: LogoutButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();

    if (!supabase || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("No se pudo cerrar sesión:", error.message);
      setIsSubmitting(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <button
      className={
        className ??
        "rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
      }
      disabled={isSubmitting}
      onClick={handleLogout}
      type="button"
    >
      {isSubmitting ? "Cerrando..." : "Cerrar sesión"}
    </button>
  );
}
