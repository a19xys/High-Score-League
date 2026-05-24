import Link from "next/link";

const links = [
  { href: "/", label: "Inicio" },
  { href: "/week", label: "Semana" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/season", label: "Temporada" },
  { href: "/submit", label: "Subir" },
  { href: "/admin", label: "Admin" },
];

export function SiteNav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="text-lg font-bold text-ink" href="/">
          High Score League
        </Link>
        <div className="flex flex-wrap gap-2 text-sm font-medium text-slate-600">
          {links.map((link) => (
            <Link
              className="rounded-md px-3 py-2 hover:bg-slate-100 hover:text-ink"
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
