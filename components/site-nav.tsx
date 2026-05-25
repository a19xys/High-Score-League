"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentWeek, mockUser } from "@/lib/mock-data";

const links = [
  { href: "/game", label: "JUEGO" },
  { href: "/weeks", label: "SEMANAS" },
  { href: "/seasons", label: "TEMPORADAS" },
  { href: "/submit", label: "SUBIR" },
];

export function SiteNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/game") {
      return pathname === "/game" || pathname === `/weeks/${currentWeek.id}`;
    }

    if (href === "/weeks") {
      return (
        pathname === "/weeks" ||
        (pathname.startsWith("/weeks/") && pathname !== `/weeks/${currentWeek.id}`)
      );
    }

    if (href === "/seasons") {
      return pathname === "/seasons" || pathname.startsWith("/seasons/");
    }

    return pathname === href;
  }

  const profileActive = pathname === "/profile";

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
              className={`rounded-md px-3 py-2 theme-hover ${
                isActive(link.href) ? "bg-[var(--hover)] theme-text" : ""
              }`}
              href={link.href}
              key={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          <Link
            aria-label="Perfil"
            aria-current={profileActive ? "page" : undefined}
            className={`flex h-10 w-10 items-center justify-center rounded-full border text-xs font-bold theme-hover ${
              profileActive
                ? "border-circuit bg-[var(--hover)] text-circuit ring-2 ring-circuit/25"
                : "theme-border theme-text"
            }`}
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
