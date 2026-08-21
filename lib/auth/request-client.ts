import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function extractBearerAccessToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer ([^\s,]+)$/i);
  return match?.[1] ?? null;
}

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

export async function createCookieOrBearerAuthenticatedClient(
  request: NextRequest,
) {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const env = getSupabaseEnv();
    if (!env.isConfigured || !env.url || !env.anonKey) return null;
    return createClient(env.url, env.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
  }
  return createCookieAuthenticatedClient();
}
