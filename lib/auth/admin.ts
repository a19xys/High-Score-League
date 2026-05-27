import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminAuthResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      userId: string;
      profile: { is_admin: boolean };
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

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return {
      ok: false,
      status: 401,
      error: "Necesitas iniciar sesión.",
      supabase,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle<{ is_admin: boolean }>();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: "No se pudo validar el perfil admin.",
      supabase,
      userId: userData.user.id,
    };
  }

  if (!profile?.is_admin) {
    return {
      ok: false,
      status: 403,
      error: "Necesitas permisos de admin.",
      supabase,
      userId: userData.user.id,
    };
  }

  return {
    ok: true,
    supabase,
    userId: userData.user.id,
    profile,
  };
}
