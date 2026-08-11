import type { SupabaseClient } from "@supabase/supabase-js";

type ActiveProfileRow = {
  id: string;
  anonymized_at: string | null;
};

export async function hasActiveProfile(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,anonymized_at")
    .eq("id", userId)
    .maybeSingle<ActiveProfileRow>();

  return {
    active: Boolean(data && data.anonymized_at === null),
    error: error?.message ?? null,
  };
}
