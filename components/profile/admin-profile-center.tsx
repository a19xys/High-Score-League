import Link from "next/link";
import type { AdminCenterData } from "./profile-types";

type AdminProfileCenterProps = {
  data: AdminCenterData;
};

const adminLinks = [
  { href: "/admin/weeks", title: "Semanas", description: "Calendario, envíos y publicación" },
  { href: "/admin/seasons", title: "Temporadas", description: "Estructura competitiva" },
  { href: "/admin/games", title: "Juegos", description: "Catálogo y recursos" },
  { href: "/admin/polls", title: "Cuestionarios", description: "Pregunta activa de la Home" },
];

export function AdminProfileCenter({ data }: AdminProfileCenterProps) {
  if (!data.isAdmin) {
    return null;
  }

  const currentWeekHref =
    data.currentWeekId && data.activeWeekCount === 1
      ? "/admin/weeks/current"
      : "/admin/weeks";

  return (
    <section
      className="scroll-mt-32 overflow-hidden rounded-[1.75rem] border shadow-panel theme-border theme-surface"
      id="centro-admin"
    >
      <div className="grid gap-5 bg-[var(--surface-strong)] px-5 py-6 text-white sm:px-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-cyan-200">
            Área separada
          </p>
          <h2 className="mt-1 text-2xl font-black text-white">Centro admin</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
            Operaciones de liga independientes de tu rendimiento personal.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          href={currentWeekHref}
        >
          {data.currentWeekLabel ?? "Revisar semanas"}
        </Link>
      </div>

      <div className="p-5 sm:p-7">
        {data.error ? (
          <p className="mb-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
            No se pudo verificar el estado de la semana activa.
          </p>
        ) : null}
        {data.activeWeekCount && data.activeWeekCount > 1 ? (
          <p className="mb-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
            Hay {data.activeWeekCount} semanas activas. Revisa la configuración.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {adminLinks.map((link) => (
            <Link
              className="rounded-xl border p-4 transition theme-border theme-surface-muted hover:-translate-y-0.5 hover:border-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit motion-reduce:transform-none"
              href={link.href}
              key={link.href}
            >
              <p className="font-extrabold theme-text">{link.title}</p>
              <p className="mt-2 text-xs leading-5 theme-text-muted">
                {link.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
