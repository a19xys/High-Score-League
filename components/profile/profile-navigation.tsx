type ProfileNavigationProps = {
  showAdmin?: boolean;
};

const baseItems = [
  { href: "#resumen", label: "Resumen" },
  { href: "#trayectoria", label: "Trayectoria" },
  { href: "#editar-perfil", label: "Editar perfil" },
  { href: "#cuenta", label: "Cuenta" },
];

export function ProfileNavigation({ showAdmin = false }: ProfileNavigationProps) {
  const items = showAdmin
    ? [...baseItems, { href: "#centro-admin", label: "Administración" }]
    : baseItems;

  return (
    <nav
      aria-label="Secciones del perfil"
      className="sticky top-20 z-20 -mx-1 flex flex-wrap gap-1 rounded-2xl border p-1.5 shadow-panel backdrop-blur-md theme-border theme-surface"
    >
      {items.map((item) => (
        <a
          className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl px-3 py-2 text-center text-xs font-extrabold transition theme-text-muted hover:bg-[var(--hover)] hover:text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit sm:flex-none sm:text-sm"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
