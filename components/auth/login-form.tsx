"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import { humanizeSupabaseError } from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PASSWORD_RESET_SUCCESS_MESSAGE =
  "Contraseña actualizada correctamente. Inicia sesión con tu nueva contraseña.";

export function LoginForm({
  passwordResetSucceeded = false,
}: {
  passwordResetSucceeded?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(
    passwordResetSucceeded ? PASSWORD_RESET_SUCCESS_MESSAGE : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.includes("@")) {
      setError("Introduce un email válido.");
      return;
    }

    if (!password) {
      setError("Introduce tu contraseña.");
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

    if (profileResult.status === "ok") {
      router.replace("/profile");
      router.refresh();
      return;
    }

    setMessage(
      profileResult.error
        ? `Sesión iniciada. ${profileResult.error} Puedes completar el perfil en /profile.`
        : "Sesión iniciada. Puedes revisar el perfil en /profile.",
    );
    router.replace("/profile");
    router.refresh();
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
      <div>
        <span className="flex items-center justify-between gap-3 text-sm">
          <label className="font-semibold theme-text" htmlFor="login-password">
            Contraseña
          </label>
          <Link
            className="rounded text-xs font-semibold text-circuit hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
            href="/forgot-password"
          >
            ¿Has olvidado tu contraseña?
          </Link>
        </span>
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
          id="login-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>
      {error ? (
        <p
          aria-live="assertive"
          className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p aria-live="polite" className="text-sm theme-text-muted" role="status">
          {message}
        </p>
      ) : null}
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
