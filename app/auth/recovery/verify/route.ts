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
import {
  applyRecoveryAuthHeaders,
  clearRecoveryState,
  createSupabaseRecoveryServerClient,
} from "@/lib/supabase/recovery-server";

export const dynamic = "force-dynamic";

function redirect(request: Request, path: string, status = 303) {
  const response = NextResponse.redirect(
    new URL(path, request.url),
    status,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const tokenHash = cookieStore.get(RECOVERY_STAGING_COOKIE)?.value;

  if (!isStructurallyValidRecoveryToken(tokenHash)) {
    const response = redirect(request, "/reset-password/invalidate", 307);
    clearRecoveryState(response, cookieStore.getAll(), {
      auth: true,
      markers: true,
      staging: true,
    });
    return response;
  }

  const recovery = await createSupabaseRecoveryServerClient();
  const verified = recovery
    ? await verifyRecoveryOtp(recovery.client.auth, tokenHash)
    : false;

  if (!recovery || !verified) {
    const response = redirect(request, "/reset-password/invalidate", 307);
    if (recovery) {
      applyRecoveryAuthHeaders(response, recovery.responseHeaders);
    }
    clearRecoveryState(response, cookieStore.getAll(), {
      auth: true,
      markers: true,
      staging: true,
    });
    return response;
  }

  const response = redirect(request, "/reset-password");
  applyRecoveryAuthHeaders(response, recovery.responseHeaders);
  clearRecoveryState(response, cookieStore.getAll(), {
    markers: true,
    staging: true,
  });
  response.cookies.set(
    RECOVERY_AUTHORIZED_COOKIE,
    RECOVERY_COOKIE_VALUE,
    getRecoveryCookieOptions("/reset-password"),
  );
  return response;
}
