"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavProfile } from "@/components/site-nav-client";

type AuthNavItemProps = {
  isSignedIn: boolean;
  profile: NavProfile | null;
  variant?: "avatar" | "link";
  onNavigate?: () => void;
};

function navLinkClass(active: boolean, variant: AuthNavItemProps["variant"] = "avatar") {
  const weightClass = variant === "link" ? "font-semibold" : "font-medium";

  return `whitespace-nowrap rounded-md border px-3 py-2 text-sm ${weightClass} transition theme-hover ${
    active
      ? "border-circuit bg-circuit/10 text-circuit shadow-sm"
      : "border-transparent theme-text-muted"
  }`;
}

export function AuthNavItem({
  isSignedIn,
  profile,
  variant = "avatar",
  onNavigate,
}: AuthNavItemProps) {
  const pathname = usePathname();
  const profileActive = pathname === "/profile";
  const loginActive = pathname === "/login" || pathname === "/register";

  if (!isSignedIn) {
    return (
      <Link
        aria-current={loginActive ? "page" : undefined}
        className={navLinkClass(loginActive, variant)}
        href="/login"
        onClick={onNavigate}
      >
        LOGIN
      </Link>
    );
  }

  if (variant === "link") {
    return (
      <Link
        aria-current={profileActive ? "page" : undefined}
        className={navLinkClass(profileActive, variant)}
        href="/profile"
        onClick={onNavigate}
      >
        PERFIL
      </Link>
    );
  }

  const label = profile?.initials ?? "...";
  const title = profile?.username
    ? `@${profile.username}`
    : profile?.email ?? "Perfil";

  return (
    <Link
      aria-label="Perfil"
      aria-current={profileActive ? "page" : undefined}
      className={`flex h-10 w-10 items-center justify-center rounded-full border text-xs font-bold theme-hover ${
        profileActive
          ? "border-circuit bg-[var(--hover)] text-circuit ring-2 ring-circuit/25"
          : "theme-border theme-text"
      }`}
      href="/profile"
      onClick={onNavigate}
      title={title}
    >
      {profile?.avatarUrl ? (
        <img
          alt={title}
          className="h-full w-full rounded-full object-cover"
          src={profile.avatarUrl}
        />
      ) : (
        label
      )}
    </Link>
  );
}
