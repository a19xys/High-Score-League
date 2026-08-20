"use client";

import { FormEvent, useState } from "react";

export function RecoveryActions() {
  const [pendingAction, setPendingAction] = useState<"cancel" | "verify" | null>(
    null,
  );

  function beginAction(
    action: "cancel" | "verify",
    event: FormEvent<HTMLFormElement>,
  ) {
    if (pendingAction) {
      event.preventDefault();
      return;
    }

    setPendingAction(action);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        action="/auth/recovery/verify"
        method="post"
        onSubmit={(event) => beginAction("verify", event)}
      >
        <button
          className="rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pendingAction !== null}
          type="submit"
        >
          {pendingAction === "verify" ? "Verificando…" : "Continuar"}
        </button>
      </form>
      <form
        action="/auth/recovery/cancel"
        method="post"
        onSubmit={(event) => beginAction("cancel", event)}
      >
        <button
          className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-text focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pendingAction !== null}
          type="submit"
        >
          {pendingAction === "cancel" ? "Cancelando…" : "Cancelar"}
        </button>
      </form>
    </div>
  );
}
