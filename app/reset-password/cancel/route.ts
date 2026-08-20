import { NextResponse } from "next/server";
import {
  getRecoveryCookieOptions,
  RECOVERY_AUTHORIZED_COOKIE,
  RECOVERY_LOGOUT_PENDING_COOKIE,
  RECOVERY_STAGING_COOKIE,
} from "@/lib/auth/password-recovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The recovery markers are still cleared below and expire independently.
    }
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

  const recoveryCookies = [
    [RECOVERY_STAGING_COOKIE, "/auth/recovery"],
    [RECOVERY_AUTHORIZED_COOKIE, "/reset-password"],
    [RECOVERY_LOGOUT_PENDING_COOKIE, "/reset-password"],
  ] as const;

  for (const [name, path] of recoveryCookies) {
    response.cookies.set(name, "", {
      ...getRecoveryCookieOptions(path),
      expires: new Date(0),
      maxAge: 0,
    });
  }

  return response;
}
