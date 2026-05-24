import Link from "next/link";
import { mockUser } from "@/lib/mock-data";

const links = [
  { href: "/game", label: "JUEGO" },
  { href: "/weeks", label: "SEMANAS" },
  { href: "/seasons", label: "TEMPORADAS" },
  { href: "/submit", label: "SUBIR" },
];

export function SiteNav() {
  return (
    <header className="border-b theme-border theme-surface">
      <nav className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="flex items-center gap-3" href="/" aria-label="High Score League">
          <span className="flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold theme-surface-strong">
            HSL
          </span>
          <span className="text-lg font-bold uppercase theme-text">
            High Score League
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium theme-text-muted">
          {links.map((link) => (
            <Link
              className="rounded-md px-3 py-2 theme-hover"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
          <Link
            aria-label="Perfil"
            className="ml-1 flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold theme-surface-strong"
            href="/profile"
            title={`@${mockUser.username}`}
          >
            {mockUser.initials}
          </Link>
        </div>
      </nav>
    </header>
  );
}
