import { SubmissionsTable } from "@/components/submissions-table";
import { ThemeSelect } from "@/components/theme-select";
import { Card, CardHeader } from "@/components/ui/card";
import { PlaceholderSection } from "@/components/ui/state";
import { formatScore } from "@/lib/format";
import {
  getBestScoresByWeek,
  getPlayerSubmissions,
  mockUser,
} from "@/lib/mock-data";

const mockEmail = "lauravc@example.com";

const adminAreas = [
  "Gestionar temporadas",
  "Gestionar semanas",
  "Moderar puntuaciones",
  "Gestionar manuales semanales",
  "Crear/editar juego",
  "Cambiar estado de semana",
];

export default function ProfilePage() {
  const recentSubmissions = getPlayerSubmissions(mockUser.id, 5);
  const bestScores = getBestScoresByWeek(mockUser.id);
  const totalUploads = recentSubmissions.length;
  const bestOverall = Math.max(...bestScores.map((score) => score.bestScore));

  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-4">
        {["Cuenta", "Configuración", "Historial", "Administración"].map((section) => (
          <a
            className="rounded-md border px-4 py-3 text-center text-sm font-semibold theme-border theme-surface theme-hover"
            href={`#${section.toLowerCase()}`}
            key={section}
          >
            {section}
          </a>
        ))}
      </div>

      <Card>
        <div id="cuenta" />
        <CardHeader eyebrow="Perfil mock" title="Cuenta">
          Esta página prepara el espacio de perfil sin autenticación real.
        </CardHeader>
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full text-xl font-bold theme-surface-strong">
              {mockUser.initials}
            </div>
            <div>
              <p className="text-3xl font-bold theme-text">{mockUser.initials}</p>
              <p className="text-sm theme-text-muted">@{mockUser.username}</p>
              <p className="mt-1 text-sm theme-text-muted">{mockEmail}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4 theme-border theme-surface-muted">
              <p className="text-xs font-semibold uppercase theme-text-muted">
                Envíos
              </p>
              <p className="mt-2 text-2xl font-bold theme-text">{totalUploads}</p>
            </div>
            <div className="rounded-lg border p-4 theme-border theme-surface-muted">
              <p className="text-xs font-semibold uppercase theme-text-muted">
                Mejor global
              </p>
              <p className="mt-2 text-2xl font-bold theme-text">
                {formatScore(bestOverall)}
              </p>
            </div>
            <div className="rounded-lg border p-4 theme-border theme-surface-muted">
              <p className="text-xs font-semibold uppercase theme-text-muted">
                Semanas
              </p>
              <p className="mt-2 text-2xl font-bold theme-text">{bestScores.length}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div id="configuración" />
        <CardHeader eyebrow="Preferencias" title="Configuración">
          Preferencias locales y edición mock. No se guarda nada en Supabase.
        </CardHeader>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-dashed p-4 text-sm theme-border theme-surface-muted">
            <p className="font-semibold theme-text">Tema visual</p>
            <ThemeSelect />
            <p className="theme-text-muted">
              La preferencia se guarda en este navegador y no usa Supabase.
            </p>
          </div>
          <div className="space-y-4 rounded-lg border p-4 theme-border theme-surface-muted">
            <label className="block">
              <span className="text-sm font-semibold theme-text">Username</span>
              <input
                className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
                disabled
                placeholder="lauravc"
                readOnly
                value={mockUser.username}
              />
              <span className="mt-2 block text-xs theme-text-muted">
                3–20 caracteres: minúsculas, números y guion bajo. Debe empezar
                por letra.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-semibold theme-text">Siglas</span>
              <input
                className="mt-2 w-full rounded-md border px-3 py-2 uppercase theme-input"
                disabled
                maxLength={3}
                placeholder="LVC"
                readOnly
                value={mockUser.initials}
              />
              <span className="mt-2 block text-xs theme-text-muted">
                3 caracteres: letras A-Z o números. Se guardan en mayúsculas.
              </span>
            </label>
            <button
              className="w-full cursor-not-allowed rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface"
              disabled
              type="button"
            >
              Editar avatar próximamente
            </button>
          </div>
        </div>
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
          <p className="font-semibold">Zona peligrosa</p>
          <p className="mt-1 text-sm">
            La eliminación de cuenta se definirá cuando exista Auth real.
          </p>
          <button
            className="mt-3 cursor-not-allowed rounded-md bg-red-200 px-4 py-2 text-sm font-semibold text-red-900"
            disabled
            type="button"
          >
            Borrar cuenta
          </button>
        </div>
      </Card>

      <Card>
        <div id="historial" />
        <CardHeader eyebrow="Historial" title="Últimas puntuaciones enviadas" />
        <SubmissionsTable
          submissions={recentSubmissions}
          showPlayer={false}
          showWeek
        />
      </Card>

      <Card>
        <CardHeader eyebrow="Historial" title="Mejores puntuaciones por semana" />
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
      </Card>

      <Card>
        <div id="administración" />
        <CardHeader eyebrow="Administración mock" title="Administración">
          Bloque provisional visible para preparar la futura experiencia admin
          dentro del perfil.
        </CardHeader>
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
      </Card>

      <PlaceholderSection
        title="Participaciones recientes"
        description="Aquí se mostrarán rachas, semanas jugadas y actividad cuando conectemos resultados reales."
      />
    </div>
  );
}
