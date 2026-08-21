import { NextResponse } from "next/server";
import { hasActiveProfile } from "@/lib/auth/active-profile";
import { usernamePattern } from "@/lib/auth/validation";
import { resolvePlayerPlayTimeApi } from "@/lib/api/player-playtime";
import { getPlayerPlayTimeSnapshot } from "@/lib/data/player-playtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
      const { data, error } = await supabase.auth.getUser();
      if (error) return { status: "error" as const };
      return data.user
        ? { status: "signed-in" as const, userId: data.user.id }
        : { status: "signed-out" as const };
    },
    hasActiveProfile,
    isValidUsername: (value) => usernamePattern.test(value),
    readSnapshot: getPlayerPlayTimeSnapshot,
  });

  return json(result.body, result.status);
}
