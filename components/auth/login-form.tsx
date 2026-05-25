"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import { humanizeSupabaseError, validatePassword } from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.includes("@")) {
      setError("Introduce un email válido.");
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase no está configurado. Revisa .env.local.");
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setIsSubmitting(false);
      setError(humanizeSupabaseError(signInError.message));
      return;
    }

    const profileResult = await ensureProfileForCurrentUser(supabase);
    setIsSubmitting(false);
    router.refresh();

    if (profileResult.status === "ok") {
      router.push("/profile");
      return;
    }

    setMessage(
      profileResult.error
        ? `Sesión iniciada. ${profileResult.error} Puedes completar el perfil en /profile.`
        : "Sesión iniciada. Puedes revisar el perfil en /profile.",
    );
    router.push("/profile");
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-semibold theme-text">Email</span>
        <input
          autoComplete="email"
          className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold theme-text">Contraseña</span>
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
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
        {isSubmitting ? "Entrando..." : "Iniciar sesión"}
      </button>
      <p className="text-sm theme-text-muted">
        ¿No tienes cuenta?{" "}
        <Link className="font-semibold text-circuit hover:underline" href="/register">
          Crear cuenta
        </Link>
      </p>
    </form>
  );
}
