"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMadridDateInput } from "@/lib/admin/home-polls";
import type { HomePollAdminData } from "@/types";

type OptionDraft = {
  id?: string;
  label: string;
  imageUrl: string;
};

type AdminHomePollFormProps = {
  initialData: HomePollAdminData;
};

function initialOptions(data: HomePollAdminData): OptionDraft[] {
  if (data.options.length > 0) {
    return data.options.map((option) => ({
      id: option.id,
      label: option.label,
      imageUrl: option.imageUrl ?? "",
    }));
  }

  return [
    { label: "", imageUrl: "" },
    { label: "", imageUrl: "" },
  ];
}

function isClosed(closesAt?: string | null) {
  return Boolean(closesAt && Date.parse(closesAt) <= Date.now());
}

export function AdminHomePollForm({ initialData }: AdminHomePollFormProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [question, setQuestion] = useState(initialData.poll.question);
  const [enabled, setEnabled] = useState(initialData.poll.enabled);
  const [closesDate, setClosesDate] = useState(
    formatMadridDateInput(initialData.poll.closesAt),
  );
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

  function updateOptionImage(index: number, imageUrl: string) {
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, imageUrl } : option,
      ),
    );
  }

  function addOption() {
    setError(null);

    if (options.length >= 32) {
      setError("No puedes añadir más de 32 opciones.");
      return;
    }

    setOptions((current) => [...current, { label: "", imageUrl: "" }]);
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
    setClosesDate(formatMadridDateInput(nextData.poll.closesAt));
    setOptions(initialOptions(nextData));
    router.refresh();
  }

  function save(nextEnabled = enabled) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/admin/polls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          closesDate,
          enabled: nextEnabled,
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
      setEnabled(nextEnabled);
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

        <div>
          <label className="block">
            <span className="text-sm font-semibold theme-text">Fecha de cierre</span>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
              onChange={(event) => setClosesDate(event.target.value)}
              type="date"
              value={closesDate}
            />
            <span className="mt-1 block text-xs theme-text-muted">
              El cuestionario se cerrará a las 23:59 de ese día.
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
              <div
                className="grid gap-2 rounded-lg border p-3 theme-border theme-surface-muted md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                key={option.id ?? `new-${index}`}
              >
                <label className="min-w-0">
                  <span className="sr-only">Opción {index + 1}</span>
                  <input
                    className="w-full rounded-md border px-3 py-2 theme-input"
                    maxLength={80}
                    onChange={(event) => updateOption(index, event.target.value)}
                    placeholder={`Opción ${index + 1}`}
                    value={option.label}
                  />
                </label>
                <label className="min-w-0">
                  <span className="sr-only">Imagen de la opción {index + 1}</span>
                  <input
                    className="w-full rounded-md border px-3 py-2 theme-input"
                    onChange={(event) => updateOptionImage(index, event.target.value)}
                    placeholder="Imagen · https://..."
                    value={option.imageUrl}
                  />
                </label>
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
          <p className="mt-2 text-xs theme-text-muted">
            Imagen opcional. Si una opción tiene imagen, todas deben tenerla.
          </p>
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
            onClick={() => save(!enabled)}
            type="button"
          >
            {enabled ? "Deshabilitar cuestionario" : "Habilitar cuestionario"}
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
                <span className="flex min-w-0 items-center gap-2 font-semibold theme-text">
                  {stat.option.imageUrl ? (
                    <img
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-md object-cover"
                      src={stat.option.imageUrl}
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{stat.option.label}</span>
                </span>
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
