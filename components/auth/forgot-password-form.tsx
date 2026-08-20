"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  requestPasswordRecovery,
  type PasswordRecoveryRequestResult,
} from "@/lib/auth/password-recovery";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] =
    useState<PasswordRecoveryRequestResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setFeedback(null);
    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const result = await requestPasswordRecovery({
      auth: supabase?.auth ?? null,
      email,
      origin: window.location.origin,
    });

    setFeedback(result);
    setIsSubmitting(false);
  }

  const isSuccess = feedback?.kind === "accepted";

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-semibold theme-text">Email</span>
        <input
          autoComplete="email"
          className="mt-2 w-full rounded-md border px-3 py-2 theme-input focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      {feedback ? (
        <p
          aria-live={isSuccess ? "polite" : "assertive"}
          className={
            isSuccess
              ? "rounded-md border p-3 text-sm theme-border theme-text-muted"
              : "rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]"
          }
          role={isSuccess ? "status" : "alert"}
        >
          {feedback.message}
        </p>
      ) : null}
      <button
        className="rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Enviando…" : "Enviar enlace"}
      </button>
      <p className="text-sm theme-text-muted">
        <Link
          className="rounded font-semibold text-circuit hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
          href="/login"
        >
          Volver a iniciar sesión
        </Link>
      </p>
    </form>
  );
}
