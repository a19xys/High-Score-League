"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { notifyAuthProfileUpdated } from "@/lib/auth/auth-events";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import {
  humanizeSupabaseError,
  normalizeInitials,
  validateInitials,
  validateUsername,
} from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealProfile } from "@/types/supabase";
import { LogoutButton } from "./logout-button";

type SessionState =
  | { status: "loading" | "not-configured" | "signed-out" }
  | { status: "signed-in"; email: string; profile: RealProfile | null; error: string | null };

export function SessionStatusCard() {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [username, setUsername] = useState("");
  const [initials, setInitials] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadSession = useCallback(async () => {
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

    const result = await ensureProfileForCurrentUser(supabase);

    if (result.status === "ok") {
      setUsername(result.profile.username);
      setInitials(result.profile.initials);
      setState({
        status: "signed-in",
        email: userData.user.email ?? "sin email",
        profile: result.profile,
        error: null,
      });
      notifyAuthProfileUpdated();
      return;
    }

    setState({
      status: "signed-in",
      email: userData.user.email ?? "sin email",
      profile: null,
      error: result.error,
    });
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setMessage(null);

    if (state.status !== "signed-in") {
      setFormError("Necesitas iniciar sesión antes de guardar el perfil.");
      return;
    }

    const cleanUsername = username.trim();
    const cleanInitials = normalizeInitials(initials);
    const usernameError = validateUsername(cleanUsername);
    const initialsError = validateInitials(cleanInitials);

    if (usernameError || initialsError) {
      setFormError(usernameError ?? initialsError);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setFormError("Supabase no está configurado. Revisa .env.local.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setFormError("La sesión ha caducado. Vuelve a iniciar sesión.");
      return;
    }

    setIsSubmitting(true);
    const response = state.profile
      ? await supabase
          .from("profiles")
          .update({ username: cleanUsername, initials: cleanInitials })
          .eq("id", userData.user.id)
          .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
          .single()
      : await supabase
          .from("profiles")
          .insert({
            id: userData.user.id,
            username: cleanUsername,
            initials: cleanInitials,
          })
          .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
          .single();
    setIsSubmitting(false);

    if (response.error) {
      setFormError(humanizeSupabaseError(response.error.message));
      return;
    }

    const profile = response.data as RealProfile;
    setUsername(profile.username);
    setInitials(profile.initials);
    setState({ ...state, profile, error: null });
    setMessage("Perfil guardado correctamente.");
    notifyAuthProfileUpdated();
  }

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
        <div className="mt-3 space-y-5">
          <div>
            <p className="theme-text-muted">Sesión activa</p>
            <p className="font-semibold theme-text">{state.email}</p>
          </div>

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
              {state.error ??
                "No se pudo crear el perfil automáticamente. Completa username y siglas aquí."}
            </div>
          )}

          <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleProfileSubmit}>
            <label className="block">
              <span className="text-sm font-semibold theme-text">Username</span>
              <input
                className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="lauravc"
                required
                value={username}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold theme-text">Siglas</span>
              <input
                className="mt-2 w-full rounded-md border px-3 py-2 uppercase theme-input"
                maxLength={3}
                onChange={(event) => setInitials(normalizeInitials(event.target.value))}
                placeholder="LVC"
                required
                value={initials}
              />
            </label>
            <div className="flex items-end">
              <button
                className="w-full rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Guardando..." : state.profile ? "Actualizar" : "Crear"}
              </button>
            </div>
          </form>
          {formError ? (
            <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
              {formError}
            </p>
          ) : null}
          {message ? <p className="text-sm theme-text-muted">{message}</p> : null}

          <LogoutButton />
        </div>
      ) : null}
    </div>
  );
}
