import { Card, CardHeader } from "@/components/ui/card";
import { players } from "@/lib/mock-data";

const currentMockUser = players[0];

const adminAreas = [
  {
    title: "Gestión de temporadas",
    description: "Crear temporadas, cambiar estado y publicar clasificación final.",
  },
  {
    title: "Gestión de semanas",
    description:
      "Configurar juego, imagen, rango de fechas, reglas y manual semanal descargable.",
  },
  {
    title: "Moderación de puntuaciones",
    description: "Revisar capturas, ocultar entradas e invalidar puntuaciones.",
  },
];

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Perfil mock" title="Cuenta">
          Esta página prepara el espacio de perfil sin autenticación real.
        </CardHeader>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-lg font-bold text-white">
            {currentMockUser.initials}
          </div>
          <div>
            <p className="text-2xl font-bold text-ink">{currentMockUser.initials}</p>
            <p className="text-sm text-slate-500">@{currentMockUser.username}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Preferencias" title="Configuración">
          Espacio reservado para tema claro/oscuro, preferencias visuales y datos
          de cuenta cuando exista Auth.
        </CardHeader>
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Preferencias mock sin persistencia.
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Administración mock" title="Administración">
          Bloque provisional visible para preparar la futura experiencia admin
          dentro del perfil.
        </CardHeader>
        <div className="grid gap-3 md:grid-cols-3">
          {adminAreas.map((area) => (
            <div
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              key={area.title}
            >
              <h2 className="font-semibold text-ink">{area.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {area.description}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
