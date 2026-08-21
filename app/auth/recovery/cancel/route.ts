import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearRecoveryState } from "@/lib/supabase/recovery-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const response = NextResponse.redirect(
    new URL("/reset-password/cancel?preverify=1", request.url),
    307,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  clearRecoveryState(response, cookieStore.getAll(), {
    auth: true,
    markers: true,
    staging: true,
  });
  return response;
}
