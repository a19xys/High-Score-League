import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  extractBearerAccessToken,
  getVerifiedProductIdentity,
} from "./session-context";

export async function createCookieAuthenticatedClient() {
  return createSupabaseServerClient();
}

export function createBearerAuthenticatedClient(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = extractBearerAccessToken(authorization);
  const env = getSupabaseEnv();
  if (!accessToken) return null;
  if (!env.isConfigured || !env.url || !env.anonKey) return null;
  return createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export type ProductRequestSession =
  | {
      status: "authenticated";
      supabase: NonNullable<
        Awaited<ReturnType<typeof createSupabaseServerClient>>
      >;
      user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown>;
      };
      userId: string;
    }
  | { status: "unauthorized" }
  | { status: "unavailable" };

async function authorizeClient(
  supabase: NonNullable<
    Awaited<ReturnType<typeof createSupabaseServerClient>>
  >,
  accessToken?: string,
): Promise<ProductRequestSession> {
  const identity = await getVerifiedProductIdentity(
    supabase.auth,
    accessToken,
  );

  if (identity.status === "unavailable") {
    return { status: "unavailable" };
  }

  if (identity.status !== "product") {
    return { status: "unauthorized" };
  }

  return {
    status: "authenticated",
    supabase,
    user: identity.user,
    userId: identity.userId,
  };
}

export async function getBearerProductRequestSession(
  request: NextRequest,
): Promise<ProductRequestSession> {
  const accessToken = extractBearerAccessToken(
    request.headers.get("authorization"),
  );

  if (!accessToken) {
    return { status: "unauthorized" };
  }

  const supabase = createBearerAuthenticatedClient(request);

  if (!supabase) {
    return { status: "unavailable" };
  }

  return authorizeClient(supabase, accessToken);
}

export async function getProductRequestSession(
  request: NextRequest,
): Promise<ProductRequestSession> {
  if (request.headers.has("authorization")) {
    return getBearerProductRequestSession(request);
  }

  const supabase = await createCookieAuthenticatedClient();

  if (!supabase) {
    return { status: "unavailable" };
  }

  return authorizeClient(supabase);
}
