import Link from "next/link";
import type { AdminCenterData } from "./profile-types";

type AdminProfileCenterProps = {
  data: AdminCenterData;
};

const adminLinks = [
  { href: "/admin/weeks", title: "Semanas", description: "Calendario, envíos y publicación", featured: false },
  { href: "/admin/seasons", title: "Temporadas", description: "Estructura competitiva", featured: false },
  { href: "/admin/games", title: "Juegos", description: "Catálogo y recursos", featured: false },
  { href: "/admin/polls", title: "Cuestionarios", description: "Pregunta activa de la Home", featured: false },
];

export function AdminProfileCenter({ data }: AdminProfileCenterProps) {
  if (!data.isAdmin) {
    return null;
  }

  const currentWeekHref =
    data.currentWeekId && data.activeWeekCount === 1
      ? "/admin/weeks/current"
      : "/admin/weeks";
  const links = [
    {
      href: currentWeekHref,
      title: "Semana actual",
      description: data.currentWeekLabel ?? "Revisar semanas",
      featured: true,
    },
    ...adminLinks,
  ];

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
        <h3 className="mb-3 text-lg font-black theme-text">Accesos</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {links.map((link) => (
            <Link
              className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit motion-reduce:transform-none ${
                link.featured
                  ? "border-circuit bg-teal-500/10 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.12),0_12px_30px_rgba(20,184,166,0.10)] sm:col-span-2 lg:col-span-2 xl:col-span-2"
                  : "theme-border theme-surface-muted"
              }`}
              href={link.href}
              key={link.title}
            >
              {link.featured ? (
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-circuit">
                  Acceso principal
                </p>
              ) : null}
              <p className={`${link.featured ? "mt-1 text-xl" : ""} font-extrabold theme-text`}>
                {link.title}
              </p>
              <p className={`${link.featured ? "mt-1 text-sm" : "mt-2 text-xs"} leading-5 theme-text-muted`}>
                {link.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
