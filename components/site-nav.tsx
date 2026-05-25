"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthNavItem } from "@/components/auth/auth-nav-item";
import { currentWeek } from "@/lib/mock-data";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const links = [
  { href: "/game", label: "JUEGO" },
  { href: "/weeks", label: "SEMANAS" },
  { href: "/seasons", label: "TEMPORADAS" },
  { href: "/submit", label: "SUBIR" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [realActiveWeekId, setRealActiveWeekId] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== "supabase") {
      setRealActiveWeekId(null);
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setRealActiveWeekId(null);
      return;
    }

    const client = supabase;
    let cancelled = false;

    async function loadActiveWeek() {
      const { data } = await client
        .from("weeks")
        .select("id")
        .eq("status", "active")
        .order("public_start_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        setRealActiveWeekId(typeof data?.id === "string" ? data.id : null);
      }
    }

    void loadActiveWeek();

    const subscription = client.auth.onAuthStateChange(() => {
      void loadActiveWeek();
    });

    return () => {
      cancelled = true;
      subscription.data.subscription.unsubscribe();
    };
  }, []);

  function isActive(href: string) {
    const activeWeekPath = realActiveWeekId
      ? `/weeks/${realActiveWeekId}`
      : `/weeks/${currentWeek.id}`;

    if (href === "/game") {
      return pathname === "/game" || pathname === activeWeekPath;
    }

    if (href === "/weeks") {
      return (
        pathname === "/weeks" ||
        (pathname.startsWith("/weeks/") && pathname !== activeWeekPath)
      );
    }

    if (href === "/seasons") {
      return pathname === "/seasons" || pathname.startsWith("/seasons/");
    }

    return pathname === href;
  }

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
          <AuthNavItem />
        </div>
      </nav>
    </header>
  );
}
