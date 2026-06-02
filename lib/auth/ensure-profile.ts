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

type SupabaseMutationError = {
  code?: string;
  message: string;
};

const profileColumns =
  "id,username,initials,avatar_url,bio,track_play_time,is_admin,created_at,updated_at";

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isPrimaryKeyConflict(error: SupabaseMutationError) {
  const message = error.message.toLowerCase();
  return (
    error.code === "23505" &&
    (message.includes("profiles_pkey") || message.includes("profiles id key"))
  );
}

function humanizeProfileInsertError(error: SupabaseMutationError) {
  const message = error.message.toLowerCase();

  if (message.includes("profiles_username_lower_unique_idx")) {
    return "Ese username ya esta usado por otro jugador.";
  }

  if (message.includes("profiles_initials_upper_unique_idx")) {
    return "Esas siglas ya estan usadas por otro jugador.";
  }

  return humanizeSupabaseError(error.message);
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
    .select(profileColumns)
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
    .select(profileColumns)
    .single();

  if (insertError) {
    if (isPrimaryKeyConflict(insertError)) {
      const { data: profileAfterRace, error: profileAfterRaceError } = await supabase
        .from("profiles")
        .select(profileColumns)
        .eq("id", userData.user.id)
        .maybeSingle();

      if (profileAfterRace) {
        return {
          status: "ok",
          profile: profileAfterRace as RealProfile,
          error: null,
        };
      }

      return {
        status: "needs-input",
        profile: null,
        error: profileAfterRaceError
          ? humanizeSupabaseError(profileAfterRaceError.message)
          : "El perfil parece existir, pero no se pudo leer de nuevo.",
      };
    }

    return {
      status: "needs-input",
      profile: null,
      error: humanizeProfileInsertError(insertError),
    };
  }

  return {
    status: "ok",
    profile: createdProfile as RealProfile,
    error: null,
  };
}
