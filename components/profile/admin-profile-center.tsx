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
    <section className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-circuit">
          Gestión de la liga
        </p>
        <h2 className="mt-1 text-2xl font-black theme-text">Administración</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 theme-text-muted">
          Operaciones de liga independientes de tu rendimiento personal.
        </p>
      </div>

      <div className="mt-6">
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
        <div className="mb-5 rounded-xl border p-4 theme-border theme-surface-muted">
          <p className="text-xs font-extrabold uppercase tracking-wide theme-text-muted">
            Semana actual
          </p>
          <Link
            className="mt-2 inline-flex min-h-11 items-center rounded-lg font-extrabold text-circuit transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
            href={currentWeekHref}
          >
            {data.currentWeekLabel ?? "Revisar semanas"}
          </Link>
        </div>
        <h3 className="mb-3 text-lg font-black theme-text">Accesos</h3>
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
