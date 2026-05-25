"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

export function createSupabaseBrowserClient() {
  const env = getSupabaseEnv();

  if (!env.isConfigured || !env.url || !env.anonKey) {
    return null;
  }

  return createBrowserClient(env.url, env.anonKey);
}

export function isSupabaseBrowserConfigured() {
  return getSupabaseEnv().isConfigured;
}
