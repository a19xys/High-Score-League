"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AuthNavItem } from "@/components/auth/auth-nav-item";

export type SiteNavData = {
  activeWeekId: string | null;
  activeSeasonId: string | null;
  activeSeasonSlug: string | null;
  hasBrandLogo: boolean;
  isSignedIn: boolean;
  profile: NavProfile | null;
};

export type NavProfile = {
  username: string | null;
  initials: string | null;
  avatarUrl: string | null;
  email: string | null;
};

type NavLink = {
  href: string;
  label: string;
  id: "home" | "leaderboard" | "classification" | "weeks" | "seasons";
};

type SiteNavClientProps = {
  data: SiteNavData;
};

const baseLinks: NavLink[] = [
  { href: "/", label: "INICIO", id: "home" },
  { href: "/weeks", label: "SEMANAS", id: "weeks" },
  { href: "/seasons", label: "TEMPORADAS", id: "seasons" },
];

function navLinkClass(active: boolean) {
  return `whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition theme-hover ${
    active
      ? "border-circuit bg-circuit/10 text-circuit shadow-sm"
      : "border-transparent theme-text-muted"
  }`;
}

function mobileLinkClass(active: boolean) {
  return `rounded-md border px-3 py-3 text-sm font-semibold transition theme-hover ${
    active
      ? "border-circuit bg-circuit/10 text-circuit"
      : "border-transparent theme-text-muted"
  }`;
}

function BrandMark({ hasBrandLogo }: { hasBrandLogo: boolean }) {
  if (hasBrandLogo) {
    return (
      <img
        alt=""
        className="h-10 w-10 rounded-md object-contain bg-transparent"
        src="/brand/logo.png"
      />
    );
  }

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold theme-surface-strong">
      HSL
    </span>
  );
}

export function SiteNavClient({ data }: SiteNavClientProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeWeekPath = data.activeWeekId ? `/weeks/${data.activeWeekId}` : null;
  const activeSeasonPaths = [
    data.activeSeasonSlug ? `/seasons/${data.activeSeasonSlug}` : null,
    data.activeSeasonId ? `/seasons/${data.activeSeasonId}` : null,
  ].filter((path): path is string => Boolean(path));
  const links: NavLink[] = data.isSignedIn
    ? [
        baseLinks[0],
        ...(activeWeekPath
          ? [
              {
                href: activeWeekPath,
                label: "LEADERBOARD",
                id: "leaderboard" as const,
              },
            ]
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
        ...baseLinks.slice(1),
      ]
    : [];
  const mobileLinks: NavLink[] = links;

  function isActive(link: NavLink) {
    if (link.href === "/") {
      return pathname === "/";
    }

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
    <header className="sticky top-0 z-50 border-b shadow-sm theme-border theme-surface">
      <nav className="mx-auto max-w-6xl px-4 py-4">
        <div className="flex items-center gap-3 lg:hidden">
          <Link
            aria-label="High Score League"
            className="flex min-w-0 flex-1 items-center gap-3"
            href="/"
            onClick={() => setMobileOpen(false)}
          >
            <BrandMark hasBrandLogo={data.hasBrandLogo} />
            <span className="hidden whitespace-nowrap text-lg font-bold uppercase theme-text md:inline">
              High Score League
            </span>
          </Link>
          <div className="shrink-0">
            <AuthNavItem isSignedIn={data.isSignedIn} profile={data.profile} />
          </div>
          <button
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border theme-border theme-hover theme-text"
            onClick={() => setMobileOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" className="grid gap-1">
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
            </span>
          </button>
        </div>

        {mobileOpen ? (
          <div className="mt-4 grid gap-2 rounded-lg border p-3 theme-border theme-surface-muted lg:hidden">
            {mobileLinks.map((link) => {
              const active = isActive(link);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={mobileLinkClass(active)}
                  href={link.href}
                  key={`${link.id}-${link.href}`}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
            <AuthNavItem
              isSignedIn={data.isSignedIn}
              onNavigate={() => setMobileOpen(false)}
              profile={data.profile}
              variant="link"
            />
          </div>
        ) : null}

        <div className="hidden items-center gap-5 lg:flex">
          <Link
            aria-label="High Score League"
            className="flex min-w-0 shrink items-center gap-3"
            href="/"
          >
            <BrandMark hasBrandLogo={data.hasBrandLogo} />
            <span className="hidden whitespace-nowrap text-lg font-bold uppercase theme-text lg:inline">
              High Score League
            </span>
          </Link>

          <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
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

          <div className="flex shrink-0 justify-end border-l pl-4 theme-border">
            <AuthNavItem isSignedIn={data.isSignedIn} profile={data.profile} />
          </div>
        </div>
      </nav>
    </header>
  );
}
