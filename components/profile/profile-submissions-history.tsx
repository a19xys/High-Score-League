"use client";

import { useMemo, useState } from "react";
import { SubmissionsTable } from "@/components/submissions-table";
import { EmptyState } from "@/components/ui/state";
import type { PlayerProfileSubmission } from "@/lib/data/player-profile";
import {
  ALL_PROFILE_GAMES,
  filterProfileSubmissionsByGame,
  getDefaultProfileSubmissionGame,
  getProfileSubmissionGameOptions,
} from "@/lib/profile-submission-games";

export function ProfileSubmissionsHistory({
  submissions,
  playerId,
  playerInitials,
}: {
  submissions: PlayerProfileSubmission[];
  playerId: string;
  playerInitials: string;
}) {
  const options = useMemo(
    () => getProfileSubmissionGameOptions(submissions),
    [submissions],
  );
  const [selectedGameId, setSelectedGameId] = useState(() =>
    getDefaultProfileSubmissionGame(submissions),
  );
  const filteredSubmissions = useMemo(
    () => filterProfileSubmissionsByGame(submissions, selectedGameId),
    [selectedGameId, submissions],
  );

  return (
    <section className="rounded-2xl border p-3 shadow-panel theme-border theme-surface sm:p-6">
      <div className="mb-5">
        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-circuit">
          Actividad privada
        </p>
        <h2 className="mt-1 text-2xl font-black theme-text">Envíos</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 theme-text-muted">
          Consulta tus intentos por juego sin alterar el cálculo global de intentos y mejores puntuaciones.
        </p>
      </div>

      {submissions.length === 0 ? (
        <EmptyState
          title="Todavía no hay envíos para este perfil."
          description="Tus envíos reales aparecerán aquí cuando registres actividad en una semana."
        />
      ) : (
        <div className="space-y-4">
          <label className="block max-w-md">
            <span className="text-sm font-extrabold theme-text">Juego</span>
            <select
              className="mt-2 min-h-11 w-full rounded-xl border px-3 py-2 theme-input focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
              onChange={(event) => setSelectedGameId(event.target.value)}
              value={selectedGameId}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
              <option value={ALL_PROFILE_GAMES}>Todos los juegos</option>
            </select>
          </label>

          <SubmissionsTable
            currentUserId={playerId}
            currentUserInitials={playerInitials}
            resetKey={selectedGameId}
            showDetectedAt
            showPlayer={false}
            showSource
            showWeek
            submissions={filteredSubmissions}
          />
        </div>
      )}
    </section>
  );
}
