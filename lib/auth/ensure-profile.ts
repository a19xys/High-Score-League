import type { SupabaseClient } from "@supabase/supabase-js";
import type { RealProfile } from "@/types/supabase";
import { getVerifiedProductIdentity } from "./session-context";
import {
  humanizeSupabaseError,
  normalizeInitials,
  validateInitials,
  validateUsername,
} from "./validation";

type EnsureProfileResult =
  | { status: "signed-out"; profile: null; error: string | null }
  | { status: "ok"; profile: RealProfile; error: null }
  | { status: "inaccessible"; profile: null; error: string }
  | { status: "needs-input"; profile: null; error: string };

type SupabaseMutationError = {
  code?: string;
  message: string;
};

const profileColumns =
  "id,username,initials,avatar_url,avatar_storage_path,bio,play_time_public,presence_public,track_play_time,is_admin,anonymized_at,created_at,updated_at";

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

  if (message.includes("username_retired") || message.includes("username_reserved")) {
    return "Ese username no está disponible.";
  }

  if (message.includes("profiles_initials_upper_unique_idx")) {
    return "Esas siglas ya estan usadas por otro jugador.";
  }

  return humanizeSupabaseError(error.message);
}

export async function ensureProfileForCurrentUser(
  supabase: SupabaseClient,
  verifiedUser?: {
    id: string;
    user_metadata?: Record<string, unknown>;
  },
): Promise<EnsureProfileResult> {
  const identity = verifiedUser
    ? null
    : await getVerifiedProductIdentity(supabase.auth);

  if (identity?.status === "unavailable") {
    return {
      status: "needs-input",
      profile: null,
      error: "No se pudo verificar la sesión.",
    };
  }

  if (identity && identity.status !== "product") {
    return identity.status === "recovery"
      ? {
          status: "inaccessible",
          profile: null,
          error: "Recovery no es una sesión de producto.",
        }
      : { status: "signed-out", profile: null, error: null };
  }

  const user = verifiedUser ?? (identity?.status === "product" ? identity.user : null);

  if (!user) {
    return { status: "signed-out", profile: null, error: null };
  }

  const { data: existingProfile, error: existingError } = await supabase
    .from("profiles")
    .select(profileColumns)
    .eq("id", user.id)
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

  const username = metadataString(user.user_metadata?.username).trim();
  const initials = normalizeInitials(
    metadataString(user.user_metadata?.initials),
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
      id: user.id,
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
        .eq("id", user.id)
        .maybeSingle();

      if (profileAfterRace) {
        return {
          status: "ok",
          profile: profileAfterRace as RealProfile,
          error: null,
        };
      }

      return {
        status: "inaccessible",
        profile: null,
        error: profileAfterRaceError
          ? humanizeSupabaseError(profileAfterRaceError.message)
          : "La cuenta ya no tiene acceso a un perfil activo.",
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
