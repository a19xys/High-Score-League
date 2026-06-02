"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthNavItem } from "@/components/auth/auth-nav-item";

export type SiteNavData = {
  activeWeekId: string | null;
  activeSeasonId: string | null;
  activeSeasonSlug: string | null;
};

type NavLink = {
  href: string;
  label: string;
  id: "leaderboard" | "classification" | "weeks" | "seasons" | "submit";
};

type SiteNavClientProps = {
  data: SiteNavData;
};

const baseLinks: NavLink[] = [
  { href: "/weeks", label: "SEMANAS", id: "weeks" },
  { href: "/seasons", label: "TEMPORADAS", id: "seasons" },
  { href: "/submit", label: "SUBIR", id: "submit" },
];

function navLinkClass(active: boolean) {
  return `whitespace-nowrap rounded-md border px-3 py-2 transition theme-hover ${
    active
      ? "border-circuit bg-circuit/10 text-circuit shadow-sm"
      : "border-transparent theme-text-muted"
  }`;
}

export function SiteNavClient({ data }: SiteNavClientProps) {
  const pathname = usePathname();
  const activeWeekPath = data.activeWeekId ? `/weeks/${data.activeWeekId}` : null;
  const activeSeasonPaths = [
    data.activeSeasonSlug ? `/seasons/${data.activeSeasonSlug}` : null,
    data.activeSeasonId ? `/seasons/${data.activeSeasonId}` : null,
  ].filter((path): path is string => Boolean(path));
  const links: NavLink[] = [
    ...(activeWeekPath
      ? [{ href: activeWeekPath, label: "LEADERBOARD", id: "leaderboard" as const }]
      : []),
    ...(activeSeasonPaths[0]
      ? [
          {
            href: activeSeasonPaths[0],
            label: "CLASIFICACIÓN",
            id: "classification" as const,
          },
        ]
      : []),
    ...baseLinks,
  ];

  function isActive(link: NavLink) {
    if (link.id === "leaderboard") {
      return pathname === "/game" || Boolean(activeWeekPath && pathname === activeWeekPath);
    }

    if (link.id === "classification") {
      return activeSeasonPaths.includes(pathname);
    }

    if (link.id === "weeks") {
      return (
        pathname === "/weeks" ||
        (pathname.startsWith("/weeks/") && pathname !== activeWeekPath)
      );
    }

    if (link.id === "seasons") {
      return (
        pathname === "/seasons" ||
        (pathname.startsWith("/seasons/") && !activeSeasonPaths.includes(pathname))
      );
    }

    return pathname === link.href;
  }

  return (
    <header className="border-b theme-border theme-surface">
      <nav className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Link
          aria-label="High Score League"
          className="flex min-w-0 items-center gap-3"
          href="/"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold theme-surface-strong">
            HSL
          </span>
          <span className="truncate whitespace-nowrap text-lg font-bold uppercase theme-text">
            High Score League
          </span>
        </Link>

        <div className="col-span-2 flex min-w-0 items-center gap-2 overflow-x-auto text-sm font-medium md:col-span-1 md:justify-end">
          {links.map((link) => {
            const active = isActive(link);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={navLinkClass(active)}
                href={link.href}
                key={link.id}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="row-start-1 flex justify-end border-l pl-3 theme-border md:row-auto">
          <AuthNavItem />
        </div>
      </nav>
    </header>
  );
}
