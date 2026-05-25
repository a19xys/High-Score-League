"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { notifyAuthProfileUpdated } from "@/lib/auth/auth-events";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import {
  humanizeSupabaseError,
  normalizeInitials,
  validateInitials,
  validatePassword,
  validateUsername,
} from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [initials, setInitials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const cleanUsername = username.trim();
    const cleanInitials = normalizeInitials(initials);

    if (!email.includes("@")) {
      setError("Introduce un email válido.");
      return;
    }

    const passwordError = validatePassword(password);
    const usernameError = validateUsername(cleanUsername);
    const initialsError = validateInitials(cleanInitials);

    if (passwordError || usernameError || initialsError) {
      setError(passwordError ?? usernameError ?? initialsError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase no está configurado. Revisa .env.local.");
      return;
    }

    setIsSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: cleanUsername,
          initials: cleanInitials,
        },
      },
    });

    if (signUpError) {
      setIsSubmitting(false);
      setError(humanizeSupabaseError(signUpError.message));
      return;
    }

    if (data.session) {
      const profileResult = await ensureProfileForCurrentUser(supabase);
      setIsSubmitting(false);
      notifyAuthProfileUpdated();
      router.refresh();

      if (profileResult.status === "ok") {
        router.push("/profile");
        return;
      }

      setError(
        `${profileResult.error ?? "No se pudo crear el perfil automáticamente."} Puedes completarlo desde /profile.`,
      );
      router.push("/profile");
      return;
    }

    setIsSubmitting(false);
    setMessage(
      "Cuenta creada. Revisa tu correo para confirmar la dirección. Después inicia sesión y el perfil se creará automáticamente con los datos enviados.",
    );
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
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold theme-text">Contraseña</span>
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold theme-text">
            Confirmar contraseña
          </span>
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold theme-text">Username</span>
          <input
            autoComplete="username"
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="lauravc"
            required
            value={username}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            Minúsculas, números y guion bajo. Debe empezar por letra.
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
            3 caracteres: letras A-Z o números.
          </span>
        </label>
      </div>
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
        {isSubmitting ? "Creando..." : "Crear cuenta"}
      </button>
      <p className="text-sm theme-text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}
