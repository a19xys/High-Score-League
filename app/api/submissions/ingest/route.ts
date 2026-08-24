import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findSubmissionDuplicate,
  insertNormalizedSubmission,
  loadCompetitionPack,
  loadCompetitionPolicy,
  loadSubmissionMembership,
  loadSubmissionWeek,
  resolveSubmissionIngest,
} from "@/lib/api/submission-ingest";
import { hasActiveProfile } from "@/lib/auth/active-profile";
import { createCookieOrBearerAuthenticatedClient } from "@/lib/auth/request-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_SUBMISSION", error: "El cuerpo debe ser JSON válido." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  let authenticatedClient: SupabaseClient | null = null;
  const result = await resolveSubmissionIngest(payload, {
    authenticate: async () => {
      authenticatedClient = await createCookieOrBearerAuthenticatedClient(request);
      if (!authenticatedClient) return { userId: null, unavailable: true };
      const authResult = await authenticatedClient.auth.getUser();
      return {
        userId: authResult.error ? null : authResult.data.user?.id ?? null,
      };
    },
    checkActiveProfile: async (userId) => {
      if (!authenticatedClient) return { active: false, error: "auth-client-unavailable" };
      return hasActiveProfile(authenticatedClient, userId);
    },
    createAdminClient: createSupabaseAdminClient,
    loadWeek: loadSubmissionWeek,
    loadPolicy: loadCompetitionPolicy,
    loadPack: loadCompetitionPack,
    findDuplicate: findSubmissionDuplicate,
    loadMembership: loadSubmissionMembership,
    insertSubmission: insertNormalizedSubmission,
    now: () => new Date(),
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
