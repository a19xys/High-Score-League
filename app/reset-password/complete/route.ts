import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  completePasswordRecovery,
  getRecoveryCookieOptions,
  hasRecoveryMarker,
  RECOVERY_AUTHORIZED_COOKIE,
  RECOVERY_COOKIE_VALUE,
  RECOVERY_LOGOUT_PENDING_COOKIE,
  RECOVERY_STAGING_COOKIE,
  retryGlobalRecoverySignOut,
} from "@/lib/auth/password-recovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirect(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function expireRecoveryState(response: NextResponse) {
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
}

function retainLogoutRetryState(response: NextResponse) {
  const options = getRecoveryCookieOptions("/reset-password");
  response.cookies.set(
    RECOVERY_AUTHORIZED_COOKIE,
    RECOVERY_COOKIE_VALUE,
    options,
  );
  response.cookies.set(
    RECOVERY_LOGOUT_PENDING_COOKIE,
    RECOVERY_COOKIE_VALUE,
    options,
  );
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const hasAuthorizedMarker = hasRecoveryMarker(
    cookieStore.get(RECOVERY_AUTHORIZED_COOKIE)?.value,
  );

  if (!hasAuthorizedMarker) {
    const response = redirect(request, "/reset-password?status=invalid");
    expireRecoveryState(response);
    return response;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    const response = redirect(request, "/reset-password?status=invalid");
    expireRecoveryState(response);
    return response;
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    const response = redirect(request, "/reset-password?status=invalid");
    expireRecoveryState(response);
    return response;
  }

  const logoutPending = hasRecoveryMarker(
    cookieStore.get(RECOVERY_LOGOUT_PENDING_COOKIE)?.value,
  );

  if (logoutPending) {
    const signedOut = await retryGlobalRecoverySignOut(supabase.auth);

    if (signedOut) {
      const response = redirect(request, "/login?passwordReset=success");
      expireRecoveryState(response);
      return response;
    }

    const response = redirect(request, "/reset-password?status=logout-pending");
    retainLogoutRetryState(response);
    return response;
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return redirect(request, "/reset-password?status=policy");
  }

  const password = formData.get("password");
  const confirmation = formData.get("confirmation");

  if (typeof password !== "string" || typeof confirmation !== "string") {
    return redirect(request, "/reset-password?status=policy");
  }

  const result = await completePasswordRecovery({
    auth: supabase.auth,
    confirmation,
    password,
  });

  if (result.kind === "success") {
    const response = redirect(request, "/login?passwordReset=success");
    expireRecoveryState(response);
    return response;
  }

  if (result.kind === "logout-error") {
    const response = redirect(request, "/reset-password?status=logout-pending");
    retainLogoutRetryState(response);
    return response;
  }

  const statusByResult = {
    mismatch: "mismatch",
    "policy-error": "policy",
    "update-error": "update-error",
  } as const;

  return redirect(request, `/reset-password?status=${statusByResult[result.kind]}`);
}
