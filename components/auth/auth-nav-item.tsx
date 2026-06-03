"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { normalizeInitials, validateInitials } from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealProfile } from "@/types/supabase";

type AuthNavState =
  | { status: "loading" | "not-configured" | "signed-out" }
  | {
      status: "signed-in";
      profile: RealProfile | null;
      email: string;
      metadataInitials: string | null;
    };

type AuthNavItemProps = {
  variant?: "avatar" | "link";
  onNavigate?: () => void;
};

function readMetadataInitials(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeInitials(value);
  return validateInitials(normalized) ? null : normalized;
}

function navLinkClass(active: boolean) {
  return `whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition theme-hover ${
    active
      ? "border-circuit bg-circuit/10 text-circuit shadow-sm"
      : "border-transparent theme-text-muted"
  }`;
}

export function AuthNavItem({ variant = "avatar", onNavigate }: AuthNavItemProps) {
  const pathname = usePathname();
  const [state, setState] = useState<AuthNavState>({ status: "loading" });
  const profileActive = pathname === "/profile";
  const loginActive = pathname === "/login" || pathname === "/register";

  const loadAuth = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setState({ status: "not-configured" });
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setState({ status: "signed-out" });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id,username,initials,avatar_url,bio,track_play_time,is_admin,created_at,updated_at")
      .eq("id", userData.user.id)
      .maybeSingle();

    setState({
      status: "signed-in",
      profile: (profile ?? null) as RealProfile | null,
      email: userData.user.email ?? "sin email",
      metadataInitials: readMetadataInitials(userData.user.user_metadata.initials),
    });
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    void loadAuth();

    const subscription = supabase?.auth.onAuthStateChange(() => {
      void loadAuth();
    });

    return () => {
      subscription?.data.subscription.unsubscribe();
    };
  }, [loadAuth, pathname]);

  if (state.status === "signed-out" || state.status === "not-configured") {
    return (
      <Link
        aria-current={loginActive ? "page" : undefined}
        className={navLinkClass(loginActive)}
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
        className={navLinkClass(profileActive)}
        href="/profile"
        onClick={onNavigate}
      >
        PERFIL
      </Link>
    );
  }

  const label =
    state.status === "signed-in" && state.profile
      ? state.profile.initials
      : state.status === "signed-in"
        ? (state.metadataInitials ?? "...")
        : "...";
  const href = "/profile";
  const title =
    state.status === "signed-in" && state.profile
      ? `@${state.profile.username}`
      : state.status === "signed-in"
        ? "Completar perfil"
        : "Cargando sesión";

  return (
    <Link
      aria-label="Perfil"
      aria-current={profileActive ? "page" : undefined}
      className={`flex h-10 w-10 items-center justify-center rounded-full border text-xs font-bold theme-hover ${
        profileActive
          ? "border-circuit bg-[var(--hover)] text-circuit ring-2 ring-circuit/25"
          : "theme-border theme-text"
      }`}
      href={href}
      onClick={onNavigate}
      title={title}
    >
      {state.status === "signed-in" && state.profile?.avatar_url ? (
        <img
          alt={title}
          className="h-full w-full rounded-full object-cover"
          src={state.profile.avatar_url}
        />
      ) : (
        label
      )}
    </Link>
  );
}
