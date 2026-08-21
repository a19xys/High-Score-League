import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  completePasswordRecovery,
  getRecoveryCookieOptions,
  hasRecoveryMarker,
  RECOVERY_AUTHORIZED_COOKIE,
  RECOVERY_COOKIE_VALUE,
  RECOVERY_LOGOUT_PENDING_COOKIE,
  retryGlobalRecoverySignOut,
} from "@/lib/auth/password-recovery";
import {
  applyRecoveryAuthHeaders,
  clearRecoveryState,
  createSupabaseRecoveryServerClient,
} from "@/lib/supabase/recovery-server";

export const dynamic = "force-dynamic";

type CookieRecord = { name: string; value: string };

function redirect(request: Request, path: string, authHeaders?: Headers) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (authHeaders) {
    applyRecoveryAuthHeaders(response, authHeaders);
  }
  return response;
}

function clearedRedirect(
  request: Request,
  path: string,
  cookiesToInspect: CookieRecord[],
  authHeaders?: Headers,
) {
  const response = redirect(request, path, authHeaders);
  clearRecoveryState(response, cookiesToInspect, {
    auth: true,
    markers: true,
    staging: true,
  });
  return response;
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
  const cookieRecords = cookieStore.getAll();
  const hasAuthorizedMarker = hasRecoveryMarker(
    cookieStore.get(RECOVERY_AUTHORIZED_COOKIE)?.value,
  );

  if (!hasAuthorizedMarker) {
    return clearedRedirect(
      request,
      "/reset-password?status=invalid",
      cookieRecords,
    );
  }

  const recovery = await createSupabaseRecoveryServerClient();

  if (!recovery) {
    return clearedRedirect(
      request,
      "/reset-password?status=invalid",
      cookieRecords,
    );
  }

  const logoutPending = hasRecoveryMarker(
    cookieStore.get(RECOVERY_LOGOUT_PENDING_COOKIE)?.value,
  );

  if (logoutPending) {
    const signedOut = await retryGlobalRecoverySignOut(recovery.client.auth);

    if (signedOut) {
      return clearedRedirect(
        request,
        "/login?passwordReset=success",
        cookieRecords,
        recovery.responseHeaders,
      );
    }

    const response = redirect(
      request,
      "/reset-password?status=logout-pending",
      recovery.responseHeaders,
    );
    retainLogoutRetryState(response);
    return response;
  }

  let hasRecoveryUser = false;
  try {
    const { data, error } = await recovery.client.auth.getUser();
    hasRecoveryUser = !error && Boolean(data.user);
  } catch {
    hasRecoveryUser = false;
  }

  if (!hasRecoveryUser) {
    return clearedRedirect(
      request,
      "/reset-password?status=invalid",
      cookieRecords,
      recovery.responseHeaders,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return redirect(
      request,
      "/reset-password?status=policy",
      recovery.responseHeaders,
    );
  }

  const password = formData.get("password");
  const confirmation = formData.get("confirmation");

  if (typeof password !== "string" || typeof confirmation !== "string") {
    return redirect(
      request,
      "/reset-password?status=policy",
      recovery.responseHeaders,
    );
  }

  const result = await completePasswordRecovery({
    auth: recovery.client.auth,
    confirmation,
    password,
  });

  if (result.kind === "success") {
    return clearedRedirect(
      request,
      "/login?passwordReset=success",
      cookieRecords,
      recovery.responseHeaders,
    );
  }

  if (result.kind === "logout-error") {
    const response = redirect(
      request,
      "/reset-password?status=logout-pending",
      recovery.responseHeaders,
    );
    retainLogoutRetryState(response);
    return response;
  }

  const statusByResult = {
    mismatch: "mismatch",
    "policy-error": "policy",
    "same-password": "same-password",
    "update-error": "update-error",
    "weak-password": "weak-password",
  } as const;

  return redirect(
    request,
    `/reset-password?status=${statusByResult[result.kind]}`,
    recovery.responseHeaders,
  );
}
