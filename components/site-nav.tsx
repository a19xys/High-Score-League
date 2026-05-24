import Link from "next/link";

const links = [
  { href: "/game", label: "Juego" },
  { href: "/weeks", label: "Semanas" },
  { href: "/seasons", label: "Temporadas" },
  { href: "/submit", label: "Subir" },
  { href: "/profile", label: "Perfil" },
];

export function SiteNav() {
  return (
    <header className="border-b theme-border theme-surface">
      <nav className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="flex items-center gap-3" href="/" aria-label="High Score League">
          <span className="flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold theme-surface-strong">
            HSL
          </span>
          <span className="text-lg font-bold theme-text">High Score League</span>
        </Link>
        <div className="flex flex-wrap gap-2 text-sm font-medium theme-text-muted">
          {links.map((link) => (
            <Link
              className="rounded-md px-3 py-2 theme-hover"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
