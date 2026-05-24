"use client";

import { useState } from "react";
import { SubmissionsTable } from "@/components/submissions-table";
import { ThemeSelect } from "@/components/theme-select";
import { PlaceholderSection } from "@/components/ui/state";
import { formatScore } from "@/lib/format";
import {
  getBestScoresByWeek,
  getPlayerSubmissions,
  mockUser,
} from "@/lib/mock-data";

type ProfileSection = "general" | "settings" | "history" | "advanced";

const sections: Array<{ id: ProfileSection; label: string; adminOnly?: boolean }> = [
  { id: "general", label: "General" },
  { id: "settings", label: "Ajustes" },
  { id: "history", label: "Historia" },
  { id: "advanced", label: "Opciones avanzadas", adminOnly: true },
];

const mockEmail = "lauravc@example.com";

const adminAreas = [
  "Gestionar temporadas",
  "Gestionar semanas",
  "Moderar puntuaciones",
  "Gestionar manuales semanales",
  "Crear/editar juego",
  "Cambiar estado de semana",
  "Gestionar descargas de juego",
];

export function ProfileDashboard() {
  const [activeSection, setActiveSection] = useState<ProfileSection>("general");
  const recentSubmissions = getPlayerSubmissions(mockUser.id, 5);
  const bestScores = getBestScoresByWeek(mockUser.id);
  const visibleSections = sections.filter(
    (section) => !section.adminOnly || mockUser.isAdmin,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="h-fit rounded-lg border p-3 theme-border theme-surface">
        <nav className="space-y-1">
          {visibleSections.map((section) => (
            <button
              className={`w-full rounded-md px-3 py-2 text-left text-sm font-semibold ${
                activeSection === section.id
                  ? "theme-surface-strong"
                  : "theme-hover theme-text-muted"
              }`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="space-y-6">
        {activeSection === "general" ? (
          <>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="text-xs font-semibold uppercase theme-text-muted">
                Perfil mock
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-full text-xl font-bold theme-surface-strong">
                  {mockUser.initials}
                </div>
                <div>
                  <p className="text-3xl font-bold theme-text">{mockUser.initials}</p>
                  <p className="text-sm theme-text-muted">@{mockUser.username}</p>
                  <p className="mt-1 text-sm theme-text-muted">{mockEmail}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Primeros puestos", "1"],
                ["Podios", "3"],
                ["Participaciones", String(bestScores.length)],
                ["Campeonatos", "0"],
                ["Medallas", "3"],
                ["Tiempo jugado", "8 h"],
              ].map(([label, value]) => (
                <div
                  className="rounded-lg border p-4 theme-border theme-surface-muted"
                  key={label}
                >
                  <p className="text-xs font-semibold uppercase theme-text-muted">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-bold theme-text">{value}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {activeSection === "settings" ? (
          <>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="font-semibold theme-text">Tema visual</p>
              <div className="mt-3">
                <ThemeSelect />
              </div>
            </div>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold theme-text">Username</span>
                  <input
                    className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                    disabled
                    readOnly
                    value={mockUser.username}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold theme-text">Siglas</span>
                  <input
                    className="mt-2 w-full rounded-md border px-3 py-2 uppercase theme-input"
                    disabled
                    readOnly
                    value={mockUser.initials}
                  />
                </label>
              </div>
              <button
                className="mt-4 cursor-not-allowed rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface-muted"
                disabled
                type="button"
              >
                Editar avatar próximamente
              </button>
              <button
                className="ml-3 mt-4 cursor-not-allowed rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface-muted"
                disabled
                type="button"
              >
                Cerrar sesión
              </button>
            </div>
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-red-200">
              <p className="font-semibold">Zona peligrosa</p>
              <p className="mt-1 text-sm">
                La eliminación de cuenta se definirá cuando exista Auth real.
              </p>
              <button
                className="mt-3 cursor-not-allowed rounded-md border border-red-500/40 px-4 py-2 text-sm font-semibold"
                disabled
                type="button"
              >
                Borrar cuenta
              </button>
            </div>
          </>
        ) : null}

        {activeSection === "history" ? (
          <>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="mb-4 font-semibold theme-text">Historial de envíos</p>
              <SubmissionsTable
                submissions={recentSubmissions}
                showPlayer={false}
                showWeek
              />
            </div>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="mb-4 font-semibold theme-text">
                Mejores puntuaciones por semana
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {bestScores.map((score) => (
                  <div
                    className="rounded-lg border p-4 theme-border theme-surface-muted"
                    key={score.week.id}
                  >
                    <p className="text-sm font-semibold theme-text">
                      Semana {score.week.number} · {score.game?.title}
                    </p>
                    <p className="mt-2 text-2xl font-bold theme-text">
                      {formatScore(score.bestScore)}
                    </p>
                    <p className="mt-1 text-sm theme-text-muted">
                      {score.uploads} subidas válidas
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <PlaceholderSection
              title="Participaciones recientes"
              description="Aquí se mostrarán juegos favoritos, tiempo por juego y actividad por temporada."
            />
          </>
        ) : null}

        {activeSection === "advanced" ? (
          <div className="rounded-lg border p-5 theme-border theme-surface">
            <p className="mb-4 font-semibold theme-text">Opciones avanzadas</p>
            <div className="grid gap-3 md:grid-cols-3">
              {adminAreas.map((area) => (
                <button
                  className="cursor-not-allowed rounded-lg border p-4 text-left font-semibold theme-border theme-surface-muted"
                  disabled
                  key={area}
                  type="button"
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
