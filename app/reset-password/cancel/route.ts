import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  applyRecoveryAuthHeaders,
  clearRecoveryState,
  createSupabaseRecoveryServerClient,
} from "@/lib/supabase/recovery-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const isPreVerifyCleanup =
    new URL(request.url).searchParams.get("preverify") === "1";
  const recovery = isPreVerifyCleanup
    ? null
    : await createSupabaseRecoveryServerClient();

  if (recovery) {
    try {
      await recovery.client.auth.signOut({ scope: "local" });
    } catch {
      // Cleanup below is authoritative even if Supabase cannot revoke locally.
    }
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

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
