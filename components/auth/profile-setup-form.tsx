"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  humanizeSupabaseError,
  normalizeInitials,
  validateInitials,
  validateUsername,
} from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealProfile } from "@/types/supabase";

type UserState =
  | { status: "loading" }
  | { status: "not-configured" }
  | { status: "signed-out" }
  | { status: "ready"; userId: string; email: string; profile: RealProfile | null };

export function ProfileSetupForm() {
  const [userState, setUserState] = useState<UserState>({ status: "loading" });
  const [username, setUsername] = useState("");
  const [initials, setInitials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const supabase = createSupabaseBrowserClient();

      if (!supabase) {
        setUserState({ status: "not-configured" });
        return;
      }

      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        setUserState({ status: "signed-out" });
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
        .eq("id", userData.user.id)
        .maybeSingle();

      const typedProfile = (profile ?? null) as RealProfile | null;
      setUsername(typedProfile?.username ?? "");
      setInitials(typedProfile?.initials ?? "");
      setUserState({
        status: "ready",
        userId: userData.user.id,
        email: userData.user.email ?? "sin email",
        profile: typedProfile,
      });
    }

    void loadProfile();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (userState.status !== "ready") {
      setError("Necesitas iniciar sesión antes de guardar el perfil.");
      return;
    }

    const cleanUsername = username.trim();
    const cleanInitials = normalizeInitials(initials);
    const usernameError = validateUsername(cleanUsername);
    const initialsError = validateInitials(cleanInitials);

    if (usernameError || initialsError) {
      setError(usernameError ?? initialsError);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase no está configurado. Revisa .env.local.");
      return;
    }

    setIsSubmitting(true);
    const response = userState.profile
      ? await supabase
          .from("profiles")
          .update({ username: cleanUsername, initials: cleanInitials })
          .eq("id", userState.userId)
          .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
          .single()
      : await supabase
          .from("profiles")
          .insert({
            id: userState.userId,
            username: cleanUsername,
            initials: cleanInitials,
          })
          .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
          .single();
    setIsSubmitting(false);

    if (response.error) {
      setError(humanizeSupabaseError(response.error.message));
      return;
    }

    const profile = response.data as RealProfile;
    setUsername(profile.username);
    setInitials(profile.initials);
    setUserState({ ...userState, profile });
    setMessage("Perfil guardado correctamente.");
  }

  if (userState.status === "loading") {
    return <p className="theme-text-muted">Cargando sesión...</p>;
  }

  if (userState.status === "not-configured") {
    return (
      <p className="theme-text-muted">
        Supabase no está configurado. Revisa `.env.local`.
      </p>
    );
  }

  if (userState.status === "signed-out") {
    return (
      <div className="space-y-3">
        <p className="theme-text-muted">Necesitas iniciar sesión para completar el perfil.</p>
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Ir a login
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 theme-border theme-surface-muted">
        <p className="text-sm theme-text-muted">Sesión activa</p>
        <p className="mt-1 font-semibold theme-text">{userState.email}</p>
        {userState.profile ? (
          <p className="mt-2 text-sm theme-text-muted">
            Perfil actual: {userState.profile.initials} · @{userState.profile.username}
            {userState.profile.is_admin ? " · admin" : ""}
          </p>
        ) : (
          <p className="mt-2 text-sm theme-text-muted">
            Todavía no hay perfil para este usuario.
          </p>
        )}
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-sm font-semibold theme-text">Username</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="lauravc"
            required
            value={username}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            3-20 caracteres: minúsculas, números y guion bajo. Debe empezar por letra.
          </span>
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
          <span className="mt-1 block text-xs theme-text-muted">
            3 caracteres: letras A-Z o números. Se guardan en mayúsculas.
          </span>
        </label>
        {error ? (
          <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-sm theme-text-muted">{message}</p> : null}
        <button
          className="rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting
            ? "Guardando..."
            : userState.profile
              ? "Actualizar perfil"
              : "Crear perfil"}
        </button>
      </form>
    </div>
  );
}
