import { NextResponse } from "next/server";
import { hasActiveProfile } from "@/lib/auth/active-profile";
import { usernamePattern } from "@/lib/auth/validation";
import { resolvePlayerPlayTimeApi } from "@/lib/api/player-playtime";
import { getPlayerPlayTimeSnapshot } from "@/lib/data/player-playtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVerifiedProductIdentity } from "@/lib/auth/session-context";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const result = await resolvePlayerPlayTimeApi(username, {
    createClient: createSupabaseServerClient,
    getViewer: async (supabase) => {
      const identity = await getVerifiedProductIdentity(supabase.auth);
      if (identity.status === "unavailable") return { status: "error" as const };
      return identity.status === "product"
        ? { status: "signed-in" as const, userId: identity.userId }
        : { status: "signed-out" as const };
    },
    hasActiveProfile,
    isValidUsername: (value) => usernamePattern.test(value),
    readSnapshot: getPlayerPlayTimeSnapshot,
  });

  return json(result.body, result.status);
}
