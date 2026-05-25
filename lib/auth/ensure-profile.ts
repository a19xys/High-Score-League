import type { SupabaseClient } from "@supabase/supabase-js";
import type { RealProfile } from "@/types/supabase";
import {
  humanizeSupabaseError,
  normalizeInitials,
  validateInitials,
  validateUsername,
} from "./validation";

type EnsureProfileResult =
  | { status: "signed-out"; profile: null; error: string | null }
  | { status: "ok"; profile: RealProfile; error: null }
  | { status: "needs-input"; profile: null; error: string };

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function ensureProfileForCurrentUser(
  supabase: SupabaseClient,
): Promise<EnsureProfileResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    return {
      status: "needs-input",
      profile: null,
      error: humanizeSupabaseError(userError.message),
    };
  }

  if (!userData.user) {
    return { status: "signed-out", profile: null, error: null };
  }

  const { data: existingProfile, error: existingError } = await supabase
    .from("profiles")
    .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (existingError) {
    return {
      status: "needs-input",
      profile: null,
      error: humanizeSupabaseError(existingError.message),
    };
  }

  if (existingProfile) {
    return {
      status: "ok",
      profile: existingProfile as RealProfile,
      error: null,
    };
  }

  const username = metadataString(userData.user.user_metadata.username).trim();
  const initials = normalizeInitials(
    metadataString(userData.user.user_metadata.initials),
  );
  const usernameError = validateUsername(username);
  const initialsError = validateInitials(initials);

  if (usernameError || initialsError) {
    return {
      status: "needs-input",
      profile: null,
      error:
        usernameError ??
        initialsError ??
        "Faltan username o siglas válidas en los metadatos del usuario.",
    };
  }

  const { data: createdProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: userData.user.id,
      username,
      initials,
    })
    .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
    .single();

  if (insertError) {
    return {
      status: "needs-input",
      profile: null,
      error: humanizeSupabaseError(insertError.message),
    };
  }

  return {
    status: "ok",
    profile: createdProfile as RealProfile,
    error: null,
  };
}
