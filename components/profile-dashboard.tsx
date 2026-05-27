"use client";

import { useState } from "react";
import Link from "next/link";
import { SessionStatusCard } from "@/components/auth/session-status-card";
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

const medals = [
  {
    label: "Campeón de Temporada I",
    icon: "I",
    locked: true,
    title: "Medalla futura: se desbloqueará al cerrar la Temporada I.",
  },
  {
    label: "Primer líder semanal",
    icon: "1",
    locked: false,
    title: "Mock: primera posición oficial en una semana cerrada.",
  },
  {
    label: "Podio en Galaga",
    icon: "G",
    locked: false,
    title: "Mock: podio conseguido en Galaga.",
  },
  {
    label: "Racha arcade",
    icon: "R",
    locked: true,
    title: "Placeholder para una futura medalla de participación continuada.",
  },
];

const adminGroups = [
  {
    title: "Temporadas y semanas",
    actions: ["Gestionar temporadas", "Gestionar semanas", "Cambiar estado de semana"],
  },
  {
    title: "Juegos y manuales",
    actions: [
      "Crear/editar juego",
      "Gestionar manuales semanales",
      "Gestionar descargas de juego",
    ],
  },
  {
    title: "Moderación",
    actions: ["Moderar puntuaciones", "Revisar envíos ocultos", "Gestionar chat público"],
  },
];

type AdminCenterData = {
  isAdmin: boolean;
  currentWeekId?: string;
  currentWeekLabel?: string;
  activeWeekCount?: number;
  error?: string | null;
};

function AdminCenter({ data }: { data: AdminCenterData }) {
  if (!data.isAdmin) {
    return null;
  }

  const currentWeekHref =
    data.currentWeekId && data.activeWeekCount === 1
      ? `/admin/weeks/${data.currentWeekId}`
      : "/admin/weeks";

  return (
    <div className="rounded-lg border p-5 theme-border theme-surface">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase theme-text-muted">
            Administración real
          </p>
          <h2 className="mt-1 text-xl font-bold theme-text">Centro admin</h2>
          <p className="mt-2 max-w-2xl text-sm theme-text-muted">
            Gestiona semanas reales, estados, submissions y resultados
            oficiales. Temporadas, juegos y usuarios quedan como placeholders.
          </p>
        </div>
        <span className="w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
          Admin
        </span>
      </div>
      {data.error ? (
        <div className="mt-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          {data.error}
        </div>
      ) : null}
      {data.activeWeekCount && data.activeWeekCount > 1 ? (
        <div className="mt-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          Hay {data.activeWeekCount} semanas activas. Revisa la configuración en
          el listado.
        </div>
      ) : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href={currentWeekHref}
        >
          <p className="font-semibold theme-text">Semana actual</p>
          <p className="mt-2 text-sm theme-text-muted">
            {data.currentWeekLabel ?? "No hay semana activa"}
          </p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/weeks"
        >
          <p className="font-semibold theme-text">Todas las semanas</p>
          <p className="mt-2 text-sm theme-text-muted">Listado y gestión semanal.</p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/seasons"
        >
          <p className="font-semibold theme-text">Temporadas</p>
          <p className="mt-2 text-sm theme-text-muted">Gestión real.</p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/games"
        >
          <p className="font-semibold theme-text">Juegos</p>
          <p className="mt-2 text-sm theme-text-muted">Catálogo real.</p>
        </Link>
        <div className="rounded-lg border p-4 opacity-70 theme-border theme-surface-muted">
          <p className="font-semibold theme-text">Usuarios</p>
          <p className="mt-2 text-sm theme-text-muted">Placeholder futuro.</p>
        </div>
      </div>
    </div>
  );
}

export function ProfileDashboard({
  adminCenter,
}: {
  adminCenter: AdminCenterData;
}) {
  const [activeSection, setActiveSection] = useState<ProfileSection>("general");
  const recentSubmissions = getPlayerSubmissions(mockUser.id, 5);
  const bestScores = getBestScoresByWeek(mockUser.id);
  const visibleSections = sections.filter(
    (section) => !section.adminOnly || adminCenter.isAdmin,
  );

  return (
    <div className="space-y-6">
      <SessionStatusCard />
      <AdminCenter data={adminCenter} />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-lg border p-3 theme-border theme-surface">
          <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {visibleSections.map((section) => (
              <button
                className={`w-full rounded-md px-3 py-2 text-left text-sm font-semibold theme-hover ${
                  activeSection === section.id ? "bg-[var(--hover)] theme-text" : "theme-text-muted"
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
            <div className="rounded-lg border p-6 theme-border theme-surface">
              <p className="text-xs font-semibold uppercase theme-text-muted">
                Perfil mock
              </p>
              <div className="mt-5 flex flex-wrap items-start gap-5">
                <div className="flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold theme-surface-strong">
                  {mockUser.initials}
                </div>
                <div className="max-w-2xl">
                  <p className="text-4xl font-bold theme-text">{mockUser.initials}</p>
                  <p className="mt-1 theme-text-muted">@{mockUser.username}</p>
                  <p className="mt-1 text-sm theme-text-muted">{mockEmail}</p>
                  <p className="mt-4 leading-7 theme-text">{mockUser.bio}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Victorias oficiales", "1", "Solo cuenta resultados cerrados o publicados."],
                ["Podios oficiales", "3", "No incluye lideratos provisionales."],
                ["Participaciones", String(bestScores.length), "Semanas con al menos un envío válido."],
                ["Campeonatos", "0", "Temporadas cerradas ganadas."],
                ["Medallas", "2", "Medallas mock desbloqueadas."],
                ["Tiempo jugado", "8 h", "Dato provisional para futuras estadísticas."],
              ].map(([label, value, help]) => (
                <div
                  className="rounded-lg border p-4 theme-border theme-surface-muted"
                  key={label}
                  title={help}
                >
                  <p className="text-xs font-semibold uppercase theme-text-muted">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-bold theme-text">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="font-semibold theme-text">Medallas futuras</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {medals.map((medal) => (
                  <div
                    className={`rounded-lg border p-4 theme-border ${
                      medal.locked ? "opacity-55 theme-surface-muted" : "theme-surface-muted"
                    }`}
                    key={medal.label}
                    title={medal.title}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold theme-surface-strong">
                      {medal.icon}
                    </div>
                    <p className="mt-3 text-sm font-semibold theme-text">{medal.label}</p>
                    <p className="mt-1 text-xs theme-text-muted">
                      {medal.locked ? "Bloqueada" : "Desbloqueada"}
                    </p>
                  </div>
                ))}
              </div>
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
                  <span className="mt-1 block text-xs theme-text-muted">
                    3-20 caracteres: minúsculas, números y guion bajo. Debe empezar por letra.
                  </span>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold theme-text">Siglas</span>
                  <input
                    className="mt-2 w-full rounded-md border px-3 py-2 uppercase theme-input"
                    disabled
                    readOnly
                    value={mockUser.initials}
                  />
                  <span className="mt-1 block text-xs theme-text-muted">
                    3 caracteres: letras A-Z o números. Se guardan en mayúsculas.
                  </span>
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold theme-text">Descripción</span>
                  <textarea
                    className="mt-2 min-h-28 w-full rounded-md border px-3 py-2 theme-input"
                    disabled
                    readOnly
                    value={mockUser.bio}
                  />
                  <span className="mt-1 block text-xs theme-text-muted">
                    Bio pública provisional. No se guarda hasta conectar perfiles reales.
                  </span>
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="cursor-not-allowed rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface-muted"
                  disabled
                  type="button"
                >
                  Cambiar avatar
                </button>
                <button
                  className="cursor-not-allowed rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface-muted"
                  disabled
                  type="button"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-5 text-[var(--warning-text)]">
              <p className="font-semibold">Zona peligrosa</p>
              <p className="mt-1 text-sm">
                La accion real para borrar cuentas de prueba esta en el bloque de
                sesion Supabase superior. Esta zona mock queda preparada para
                futuras opciones privadas.
              </p>
              <button
                className="mt-3 cursor-not-allowed rounded-md border border-[var(--warning-border)] px-4 py-2 text-sm font-semibold"
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
            <div className="space-y-5">
              {adminGroups.map((group) => (
                <section key={group.title}>
                  <p className="mb-3 text-sm font-semibold uppercase theme-text-muted">
                    {group.title}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.actions.map((action) => (
                      <button
                        className="cursor-not-allowed rounded-lg border p-4 text-left font-semibold theme-border theme-surface-muted"
                        disabled
                        key={action}
                        type="button"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}
        </section>
      </div>
    </div>
  );
}
