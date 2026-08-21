import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  createRecoveryCookieAdapter,
  RECOVERY_AUTH_COOKIE_PATH,
  RECOVERY_AUTH_STORAGE_KEY,
} from "./recovery-cookies";
import { getSupabaseEnv } from "./env";

export * from "./recovery-cookies";

export async function createSupabaseRecoveryServerClient() {
  const env = getSupabaseEnv();

  if (!env.isConfigured || !env.url || !env.anonKey) {
    return null;
  }

  const cookieStore = await cookies();
  const responseHeaders = new Headers();
  const client = createServerClient(env.url, env.anonKey, {
    cookieOptions: {
      name: RECOVERY_AUTH_STORAGE_KEY,
      path: RECOVERY_AUTH_COOKIE_PATH,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
    cookies: createRecoveryCookieAdapter(cookieStore, responseHeaders),
  });

  return { client, responseHeaders };
}
