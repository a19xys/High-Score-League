import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminAuthResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown>;
      };
      userId: string;
      profile: { anonymized_at: string | null; is_admin: boolean };
    }
  | {
      ok: false;
      status: number;
      error: string;
      supabase?: SupabaseClient;
      userId?: string;
    };

export async function requireAdmin(): Promise<AdminAuthResult> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { ok: false, status: 500, error: "Supabase no está configurado." };
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const user = data.user;

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      error: "Necesitas iniciar sesión.",
      supabase,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin,anonymized_at")
    .eq("id", user.id)
    .maybeSingle<{ anonymized_at: string | null; is_admin: boolean }>();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: "No se pudo validar el perfil admin.",
      supabase,
      userId: user.id,
    };
  }

  if (!profile?.is_admin || profile.anonymized_at !== null) {
    return {
      ok: false,
      status: 403,
      error: "Necesitas permisos de admin.",
      supabase,
      userId: user.id,
    };
  }

  return {
    ok: true,
    supabase,
    user,
    userId: user.id,
    profile,
  };
}
