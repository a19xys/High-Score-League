import type { DataSource } from "./types";

export function getDataSource(): DataSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase"
    ? "supabase"
    : "mock";
}

export function isSupabaseDataSource() {
  return getDataSource() === "supabase";
}
