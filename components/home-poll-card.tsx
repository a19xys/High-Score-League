"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PublicHomePoll } from "@/types";
import { Card, CardHeader } from "@/components/ui/card";

type HomePollPayload = {
  ok: boolean;
  error?: string;
  poll?: PublicHomePoll | null;
};

function formatCloseDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

function voteLabel(votes?: number) {
  if (votes === undefined) {
    return "";
  }

  return votes === 1 ? "1 voto" : `${votes} votos`;
}

export function HomePollCard() {
  const [poll, setPoll] = useState<PublicHomePoll | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [isPending, startTransition] = useTransition();

  const refreshPoll = useCallback(async () => {
    try {
      const response = await fetch("/api/home-poll", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.status === 401) {
        setPoll(null);
        setHasLoaded(true);
        return;
      }

      const payload = (await response.json()) as HomePollPayload;

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "No se pudo cargar el cuestionario.");
        setHasLoaded(true);
        return;
      }

      setPoll(payload.poll ?? null);
      setError(null);
      setHasLoaded(true);
    } catch {
      setError("No se pudo cargar el cuestionario.");
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshPoll();
  }, [refreshPoll]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel("home-poll-votes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "home_poll_votes",
        },
        () => {
          void refreshPoll();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshPoll]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshPoll();
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshPoll]);

  function vote(optionId: string) {
    if (isPending) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/home-poll/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const payload = (await response.json()) as HomePollPayload;

      if (!response.ok || !payload.ok || !payload.poll) {
        setError(payload.error ?? "No se pudo registrar tu voto.");
        return;
      }

      setPoll(payload.poll);
    });
  }

  if (!hasLoaded || !poll) {
    return null;
  }

  const usesImages =
    poll.options.length > 0 && poll.options.every((option) => Boolean(option.imageUrl));

  return (
    <Card className="overflow-hidden">
      <CardHeader title={poll.question} eyebrow="Cuestionario">
        Cierra el {formatCloseDate(poll.closesAt)}.
      </CardHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          {poll.options.map((option) => {
            const selected = option.id === poll.selectedOptionId;
            const percentage = poll.hasVoted ? (option.percentage ?? 0) : 0;

            return (
              <button
                aria-pressed={selected}
                className={`relative w-full overflow-hidden rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
                  selected
                    ? "border-circuit bg-circuit/10"
                    : "theme-border theme-surface-muted theme-hover"
                } ${usesImages ? "min-h-[4.75rem]" : "min-h-16"}`}
                disabled={isPending}
                key={option.id}
                onClick={() => vote(option.id)}
                type="button"
              >
                {poll.hasVoted ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 bg-circuit/20 transition-[width] duration-700 ease-out"
                    style={{ width: `${percentage}%` }}
                  />
                ) : null}
                <span className="relative z-10 flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-circuit bg-circuit" : "theme-border"
                    }`}
                  >
                    {selected ? (
                      <span className="h-2 w-2 rounded-full bg-white" />
                    ) : null}
                  </span>
                  {usesImages ? (
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md sm:h-12 sm:w-12">
                      {option.imageUrl && !failedImages.has(option.id) ? (
                        <img
                          alt=""
                          className="h-full w-full object-cover"
                          onError={() =>
                            setFailedImages((current) => {
                              const next = new Set(current);
                              next.add(option.id);
                              return next;
                            })
                          }
                          src={option.imageUrl}
                        />
                      ) : null}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 overflow-hidden font-semibold leading-5 theme-text [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                    {option.label}
                  </span>
                  {poll.hasVoted ? (
                    <span className="shrink-0 text-right">
                      <span className="block font-bold text-circuit">
                        {percentage}%
                      </span>
                      <span className="hidden text-xs theme-text-muted sm:block">
                        {voteLabel(option.votes)}
                      </span>
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        {poll.hasVoted ? (
          <p className="text-sm theme-text-muted">
            Puedes cambiar tu voto mientras el cuestionario siga abierto.
            {poll.totalVotes !== undefined ? ` Total votos: ${poll.totalVotes}.` : ""}
          </p>
        ) : (
          <p className="text-sm theme-text-muted">
            Vota para ver los resultados agregados.
          </p>
        )}
        {error ? (
          <p className="text-sm text-[var(--warning-text)]">{error}</p>
        ) : null}
      </div>
    </Card>
  );
}
