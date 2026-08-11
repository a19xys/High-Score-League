import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createCookieAuthenticatedClient() {
  return createSupabaseServerClient();
}

export function createBearerAuthenticatedClient(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const env = getSupabaseEnv();
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  if (!env.isConfigured || !env.url || !env.anonKey) return null;
  return createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
}

