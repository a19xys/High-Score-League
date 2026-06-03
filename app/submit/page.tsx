import { AccessRequired } from "@/components/auth/access-required";
import { SubmitFallbackForm } from "@/components/submit-fallback-form";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PlaceholderSection } from "@/components/ui/state";
import { hasServerSession } from "@/lib/auth/session";
import { getActiveWeekDetailData } from "@/lib/data/week-detail";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Subir | High Score League",
};

export default async function SubmitPage() {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const activeWeek = await getActiveWeekDetailData();

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Card>
          {activeWeek.status === "ok" ? (
            <>
              <CardHeader
                eyebrow={`Semana ${activeWeek.data.week.number}`}
                title={`Subir puntuación · ${activeWeek.data.game.title}`}
              >
                Formulario manual provisional. El flujo principal es automático
                desde MAME/app local; esta pantalla queda como herramienta de
                respaldo.
              </CardHeader>
              <SubmitFallbackForm />
            </>
          ) : (
            <>
              <CardHeader title="Subida no disponible" eyebrow="Semana activa" />
              <EmptyState
                title="No hay semana activa."
                description={activeWeek.message}
              />
            </>
          )}
        </Card>

        <div className="space-y-6">
          <PlaceholderSection
            title="Captura opcional"
            description="Las capturas no son requisito central del flujo automático. Si se adjuntan más adelante, se comprimirán antes de subirlas a Supabase Storage."
          />
          <PlaceholderSection
            title="Historial permitido"
            description="La clasificación usa tu mejor puntuación válida de la semana. Puedes registrar puntuaciones inferiores a tu récord personal si quieres conservar el historial."
          />
        </div>
      </section>
    </div>
  );
}
