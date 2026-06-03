import { AccessRequired } from "@/components/auth/access-required";
import { SubmitMockForm } from "@/components/submit-mock-form";
import { SubmissionsTable } from "@/components/submissions-table";
import { Card, CardHeader } from "@/components/ui/card";
import { PlaceholderSection } from "@/components/ui/state";
import {
  currentWeek,
  getCurrentGame,
  getPlayerSubmissions,
  mockUser,
} from "@/lib/mock-data";
import { hasServerSession } from "@/lib/auth/session";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subir | High Score League",
};

export default async function SubmitPage() {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const game = getCurrentGame();
  const recentSubmissions = getPlayerSubmissions(mockUser.id, 5);

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader
            eyebrow={`Semana ${currentWeek.number}`}
            title={`Subir puntuación · ${game.title}`}
          >
            Formulario manual provisional. El flujo principal futuro será
            automático desde MAME/app local; esta pantalla queda como fallback y
            herramienta de pruebas.
          </CardHeader>
          <SubmitMockForm />
        </Card>

        <div className="space-y-6">
          <PlaceholderSection
            title="Captura opcional"
            description="Las capturas ya no serán requisito central del flujo automático. Si se adjuntan más adelante, se comprimirán antes de subirlas a Supabase Storage."
          />
          <PlaceholderSection
            title="Historial permitido"
            description="La clasificación usará tu mejor puntuación válida de la semana. Puedes subir puntuaciones inferiores a tu récord personal si quieres conservar el historial."
          />
        </div>
      </section>

      <Card>
        <CardHeader title="Tus últimos envíos" eyebrow="Historial mock" />
        <SubmissionsTable
          submissions={recentSubmissions}
          showPlayer={false}
          showWeek
        />
      </Card>
    </div>
  );
}
