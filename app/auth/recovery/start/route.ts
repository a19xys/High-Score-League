import { type NextRequest, NextResponse } from "next/server";
import {
  getRecoveryCookieOptions,
  RECOVERY_STAGING_COOKIE,
  selectRecoveryToken,
} from "@/lib/auth/password-recovery";

export const dynamic = "force-dynamic";

function recoveryResponse(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/auth/recovery", request.url),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function GET(request: NextRequest) {
  const response = recoveryResponse(request);
  const tokenHash = selectRecoveryToken(
    request.nextUrl.searchParams.getAll("token_hash"),
  );
  const cookieOptions = getRecoveryCookieOptions("/auth/recovery");

  if (tokenHash) {
    response.cookies.set(RECOVERY_STAGING_COOKIE, tokenHash, cookieOptions);
  } else {
    response.cookies.set(RECOVERY_STAGING_COOKIE, "", {
      ...cookieOptions,
      expires: new Date(0),
      maxAge: 0,
    });
  }

  return response;
}
