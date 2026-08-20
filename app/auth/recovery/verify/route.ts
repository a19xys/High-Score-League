import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getRecoveryCookieOptions,
  isStructurallyValidRecoveryToken,
  RECOVERY_AUTHORIZED_COOKIE,
  RECOVERY_COOKIE_VALUE,
  RECOVERY_LOGOUT_PENDING_COOKIE,
  RECOVERY_STAGING_COOKIE,
  verifyRecoveryOtp,
} from "@/lib/auth/password-recovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirect(request: Request, path: string) {
  const response = NextResponse.redirect(
    new URL(path, request.url),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function expireCookie(response: NextResponse, name: string, path: string) {
  response.cookies.set(name, "", {
    ...getRecoveryCookieOptions(path),
    expires: new Date(0),
    maxAge: 0,
  });
}

function expireAllRecoveryState(response: NextResponse) {
  expireCookie(response, RECOVERY_STAGING_COOKIE, "/auth/recovery");
  expireCookie(response, RECOVERY_AUTHORIZED_COOKIE, "/reset-password");
  expireCookie(response, RECOVERY_LOGOUT_PENDING_COOKIE, "/reset-password");
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const tokenHash = cookieStore.get(RECOVERY_STAGING_COOKIE)?.value;

  if (!isStructurallyValidRecoveryToken(tokenHash)) {
    const response = redirect(request, "/auth/recovery");
    expireAllRecoveryState(response);
    return response;
  }

  const supabase = await createSupabaseServerClient();
  const verified = supabase
    ? await verifyRecoveryOtp(supabase.auth, tokenHash)
    : false;

  if (!verified) {
    const response = redirect(request, "/auth/recovery");
    expireAllRecoveryState(response);
    return response;
  }

  const response = redirect(request, "/reset-password");
  expireCookie(response, RECOVERY_STAGING_COOKIE, "/auth/recovery");
  expireCookie(response, RECOVERY_LOGOUT_PENDING_COOKIE, "/reset-password");
  response.cookies.set(
    RECOVERY_AUTHORIZED_COOKIE,
    RECOVERY_COOKIE_VALUE,
    getRecoveryCookieOptions("/reset-password"),
  );
  return response;
}
