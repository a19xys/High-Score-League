import { Card, CardHeader } from "@/components/ui/card";
import { currentWeek, getCurrentGame } from "@/lib/mock-data";

export default function SubmitPage() {
  const game = getCurrentGame();

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader eyebrow={`Semana ${currentWeek.number}`} title={`Subir puntuación · ${game.title}`}>
          Formulario provisional. La subida real se conectará a Supabase Auth,
          Database y Storage en una fase posterior.
        </CardHeader>

        <form className="space-y-5">
          <label className="block">
            <span className="text-sm font-semibold text-ink">Puntuación</span>
            <input
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-ink outline-none ring-circuit/20 focus:border-circuit focus:ring-4"
              min="0"
              placeholder="184320"
              type="number"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Captura</span>
            <input
              className="mt-2 w-full rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-700"
              type="file"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Comentario opcional</span>
            <textarea
              className="mt-2 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-ink outline-none ring-circuit/20 focus:border-circuit focus:ring-4"
              placeholder="Detalles de la partida, plataforma o contexto."
            />
          </label>

          <button
            className="w-full cursor-not-allowed rounded-md bg-slate-300 px-4 py-3 text-sm font-semibold text-slate-600"
            disabled
            type="button"
          >
            Envío mock desactivado
          </button>
        </form>
      </Card>
    </div>
  );
}
