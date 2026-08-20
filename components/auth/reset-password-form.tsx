"use client";

import { FormEvent, useState } from "react";
import {
  NEW_PASSWORD_REQUIREMENTS,
  validateNewPassword,
} from "@/lib/auth/validation";
import {
  RECOVERY_LOGOUT_ERROR_MESSAGE,
  RECOVERY_UPDATE_ERROR_MESSAGE,
} from "@/lib/auth/password-recovery";

type ResetPasswordStatus =
  | "invalid"
  | "logout-pending"
  | "mismatch"
  | "policy"
  | "update-error";

function statusMessage(status: ResetPasswordStatus | null) {
  if (status === "mismatch") {
    return "Las contraseñas no coinciden.";
  }

  if (status === "policy") {
    return NEW_PASSWORD_REQUIREMENTS;
  }

  if (status === "update-error") {
    return RECOVERY_UPDATE_ERROR_MESSAGE;
  }

  if (status === "logout-pending") {
    return RECOVERY_LOGOUT_ERROR_MESSAGE;
  }

  return null;
}

export function ResetPasswordForm({
  logoutPending,
  status,
}: {
  logoutPending: boolean;
  status: ResetPasswordStatus | null;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"cancel" | "submit" | null>(
    null,
  );

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    if (pendingAction) {
      event.preventDefault();
      return;
    }

    setClientError(null);

    if (!logoutPending) {
      const passwordError = validateNewPassword(password);

      if (passwordError) {
        event.preventDefault();
        setClientError(passwordError);
        return;
      }

      if (password !== confirmation) {
        event.preventDefault();
        setClientError("Las contraseñas no coinciden.");
        return;
      }
    }

    setPendingAction("submit");
  }

  function cancelRecovery(event: FormEvent<HTMLFormElement>) {
    if (pendingAction) {
      event.preventDefault();
      return;
    }

    setPendingAction("cancel");
  }

  const error = clientError ?? statusMessage(status);

  return (
    <div className="space-y-4">
      {logoutPending ? (
        <p
          aria-live="assertive"
          className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]"
          role="alert"
        >
          {RECOVERY_LOGOUT_ERROR_MESSAGE}
        </p>
      ) : null}
      <form
        action="/reset-password/complete"
        className="space-y-4"
        method="post"
        onSubmit={submitPassword}
      >
        {logoutPending ? null : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold theme-text">
                  Nueva contraseña
                </span>
                <input
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-md border px-3 py-2 theme-input focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
                  name="password"
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
                  className="mt-2 w-full rounded-md border px-3 py-2 theme-input focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
                  name="confirmation"
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  type="password"
                  value={confirmation}
                />
              </label>
            </div>
            <p className="text-xs theme-text-muted">
              Mínimo 8 caracteres, con al menos una mayúscula, una minúscula y
              un número. Los caracteres especiales son opcionales.
            </p>
          </>
        )}
        {error && !logoutPending ? (
          <p
            aria-live="assertive"
            className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <button
          className="rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pendingAction !== null}
          type="submit"
        >
          {pendingAction === "submit"
            ? logoutPending
              ? "Cerrando sesiones…"
              : "Cambiando…"
            : logoutPending
              ? "Reintentar cierre de sesiones"
              : "Cambiar contraseña"}
        </button>
      </form>
      {logoutPending ? null : (
        <form
          action="/reset-password/cancel"
          method="post"
          onSubmit={cancelRecovery}
        >
          <button
            className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-text focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pendingAction !== null}
            type="submit"
          >
            {pendingAction === "cancel" ? "Cancelando…" : "Cancelar"}
          </button>
        </form>
      )}
    </div>
  );
}
