"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealProfile } from "@/types/supabase";

type SessionState =
  | { status: "loading" | "not-configured" | "signed-out" }
  | { status: "signed-in"; email: string; profile: RealProfile | null };

export function SessionStatusCard() {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    async function loadSession() {
      const supabase = createSupabaseBrowserClient();

      if (!supabase) {
        setState({ status: "not-configured" });
        return;
      }

      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        setState({ status: "signed-out" });
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
        .eq("id", userData.user.id)
        .maybeSingle();

      setState({
        status: "signed-in",
        email: userData.user.email ?? "sin email",
        profile: (profile ?? null) as RealProfile | null,
      });
    }

    void loadSession();
  }, []);

  return (
    <div className="rounded-lg border p-5 theme-border theme-surface">
      <p className="text-xs font-semibold uppercase theme-text-muted">
        Sesión real Supabase
      </p>
      {state.status === "loading" ? (
        <p className="mt-3 theme-text-muted">Comprobando sesión...</p>
      ) : null}
      {state.status === "not-configured" ? (
        <p className="mt-3 theme-text-muted">
          Supabase no está configurado. El perfil mock sigue disponible debajo.
        </p>
      ) : null}
      {state.status === "signed-out" ? (
        <div className="mt-3 space-y-3">
          <p className="theme-text-muted">
            No hay sesión activa. El perfil inferior sigue mostrando datos mock.
          </p>
          <Link className="font-semibold text-circuit hover:underline" href="/login">
            Iniciar sesión
          </Link>
        </div>
      ) : null}
      {state.status === "signed-in" ? (
        <div className="mt-3 space-y-3">
          <p className="theme-text-muted">Sesión activa</p>
          <p className="font-semibold theme-text">{state.email}</p>
          {state.profile ? (
            <div className="rounded-lg border p-4 theme-border theme-surface-muted">
              <p className="font-semibold theme-text">
                {state.profile.initials} · @{state.profile.username}
              </p>
              <p className="mt-1 text-sm theme-text-muted">
                {state.profile.is_admin ? "Admin real" : "Jugador real"}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
              Falta completar el perfil real.{" "}
              <Link className="font-semibold underline" href="/profile/setup">
                Ir a profile/setup
              </Link>
            </div>
          )}
          <LogoutButton />
        </div>
      ) : null}
    </div>
  );
}
