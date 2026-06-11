"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HomePollAdminData } from "@/types";

type OptionDraft = {
  id?: string;
  label: string;
};

type AdminHomePollFormProps = {
  initialData: HomePollAdminData;
};

function toDateTimeLocal(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);

  return local.toISOString().slice(0, 16);
}

function toIsoDate(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function initialOptions(data: HomePollAdminData): OptionDraft[] {
  if (data.options.length > 0) {
    return data.options.map((option) => ({
      id: option.id,
      label: option.label,
    }));
  }

  return [{ label: "" }, { label: "" }];
}

function isClosed(closesAt?: string | null) {
  return Boolean(closesAt && Date.parse(closesAt) <= Date.now());
}

export function AdminHomePollForm({ initialData }: AdminHomePollFormProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [question, setQuestion] = useState(initialData.poll.question);
  const [enabled, setEnabled] = useState(initialData.poll.enabled);
  const [closesAt, setClosesAt] = useState(toDateTimeLocal(initialData.poll.closesAt));
  const [options, setOptions] = useState<OptionDraft[]>(() => initialOptions(initialData));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetText, setResetText] = useState("");
  const [isPending, startTransition] = useTransition();
  const closed = isClosed(data.poll.closesAt);
  const configured = data.poll.question.trim().length > 0 && data.options.length >= 2;

  const statusMessage = useMemo(() => {
    if (closed) {
      return "Este cuestionario está cerrado por fecha. Puedes reabrirlo alargando la fecha de cierre.";
    }

    if (!data.poll.enabled) {
      return "Deshabilitado: no aparecerá en Home aunque la fecha siga abierta.";
    }

    return "Visible en Home cuando se implemente la tarjeta pública.";
  }, [closed, data.poll.enabled]);

  function updateOption(index: number, label: string) {
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, label } : option,
      ),
    );
  }

  function addOption() {
    setError(null);

    if (options.length >= 32) {
      setError("No puedes añadir más de 32 opciones.");
      return;
    }

    setOptions((current) => [...current, { label: "" }]);
  }

  function removeOption(index: number) {
    if (options.length <= 2) {
      setError("Añade al menos dos opciones.");
      return;
    }

    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
  }

  function applyData(nextData: HomePollAdminData) {
    setData(nextData);
    setQuestion(nextData.poll.question);
    setEnabled(nextData.poll.enabled);
    setClosesAt(toDateTimeLocal(nextData.poll.closesAt));
    setOptions(initialOptions(nextData));
    router.refresh();
  }

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/admin/polls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          closesAt: toIsoDate(closesAt),
          enabled,
          options,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: HomePollAdminData;
      };

      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error ?? "No se pudo guardar el cuestionario.");
        return;
      }

      applyData(payload.data);
      setMessage("Cuestionario guardado.");
    });
  }

  function reset() {
    setError(null);
    setMessage(null);

    if (resetText !== "REINICIAR") {
      setError("Escribe REINICIAR para borrar opciones y votos.");
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/admin/polls/reset", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: HomePollAdminData;
      };

      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error ?? "No se pudo reiniciar el cuestionario.");
        return;
      }

      applyData(payload.data);
      setResetText("");
      setMessage("Cuestionario reiniciado.");
    });
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="rounded-lg border p-4 theme-border theme-surface-muted">
          <p className="text-sm font-semibold theme-text">{statusMessage}</p>
          {!configured ? (
            <p className="mt-1 text-sm theme-text-muted">
              Configura una pregunta y al menos dos opciones.
            </p>
          ) : null}
        </div>

        <label className="block">
          <span className="text-sm font-semibold theme-text">Pregunta</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="¿Qué juego te gustaría ver en una próxima semana?"
            value={question}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold theme-text">Fecha y hora de cierre</span>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
              onChange={(event) => setClosesAt(event.target.value)}
              type="datetime-local"
              value={closesAt}
            />
          </label>

          <label className="flex items-start gap-3 rounded-lg border p-4 theme-border theme-surface-muted">
            <input
              checked={enabled}
              className="mt-1"
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="block font-semibold theme-text">Habilitado</span>
              <span className="mt-1 block text-sm theme-text-muted">
                Si está deshabilitado, no aparecerá en Home.
              </span>
            </span>
          </label>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold theme-text">Opciones</p>
              <p className="mt-1 text-xs theme-text-muted">
                Mínimo 2, máximo 32. El orden se guarda tal como aparece aquí.
              </p>
            </div>
            <button
              className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover theme-text"
              onClick={addOption}
              type="button"
            >
              + Añadir opción
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {options.map((option, index) => (
              <div className="flex gap-2" key={option.id ?? `new-${index}`}>
                <input
                  className="min-w-0 flex-1 rounded-md border px-3 py-2 theme-input"
                  onChange={(event) => updateOption(index, event.target.value)}
                  placeholder={`Opción ${index + 1}`}
                  value={option.label}
                />
                <button
                  className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover theme-text disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={options.length <= 2}
                  onClick={() => removeOption(index)}
                  type="button"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-sm theme-text-muted">{message}</p> : null}

        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            type="submit"
          >
            Guardar cuestionario
          </button>
          <button
            className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-hover theme-text disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={() => setEnabled((current) => !current)}
            type="button"
          >
            {enabled ? "Deshabilitar" : "Habilitar"}
          </button>
        </div>
      </form>

      <div className="rounded-lg border p-4 theme-border theme-surface-muted">
        <p className="font-semibold theme-text">Estadísticas</p>
        <p className="mt-1 text-sm theme-text-muted">Total votos: {data.totalVotes}</p>
        {data.totalVotes === 0 ? (
          <p className="mt-4 text-sm theme-text-muted">Todavía no hay votos.</p>
        ) : null}
        <div className="mt-4 space-y-3">
          {data.stats.map((stat) => (
            <div key={stat.option.id}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold theme-text">{stat.option.label}</span>
                <span className="theme-text-muted">
                  {stat.votes} votos · {stat.percentage}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full theme-surface-strong">
                <div
                  className="h-full rounded-full bg-circuit"
                  style={{ width: `${stat.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-[var(--warning-text)]">
        <p className="font-semibold">Zona peligrosa</p>
        <p className="mt-1 text-sm">
          Escribe REINICIAR para borrar las opciones y votos del cuestionario actual.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setResetText(event.target.value)}
            placeholder="REINICIAR"
            value={resetText}
          />
          <button
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={reset}
            type="button"
          >
            Reiniciar cuestionario
          </button>
        </div>
      </div>
    </div>
  );
}
