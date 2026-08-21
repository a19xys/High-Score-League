import { NextResponse } from "next/server";
import { usernamePattern } from "@/lib/auth/validation";
import { getPlayerProfilePreview } from "@/lib/data/player-profile-preview";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PreviewRouteContext = {
  params: Promise<{ username: string }>;
};

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

function errorResponse(status: number) {
  return NextResponse.json(
    { ok: false, error: "La vista previa no está disponible." },
    { headers: responseHeaders, status },
  );
}

export async function GET(
  _request: Request,
  { params }: PreviewRouteContext,
) {
  const { username } = await params;

  if (!usernamePattern.test(username)) {
    return errorResponse(404);
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return errorResponse(503);
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const user = data.user;

  if (userError || !user) {
    return errorResponse(401);
  }

  const result = await getPlayerProfilePreview(
    supabase,
    username,
    user.id,
  );

  if (result.status === "not-found") {
    return errorResponse(404);
  }

  if (result.status === "error") {
    return errorResponse(503);
  }

  return NextResponse.json(
    { ok: true, preview: result.preview },
    { headers: responseHeaders },
  );
}
