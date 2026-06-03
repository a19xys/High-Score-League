import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ServerSession =
  | { status: "not-configured"; userId: null; email: null }
  | { status: "signed-out"; userId: null; email: null }
  | { status: "signed-in"; userId: string; email: string | null };

export async function getServerSession(): Promise<ServerSession> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { status: "not-configured", userId: null, email: null };
  }

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return { status: "signed-out", userId: null, email: null };
  }

  return {
    status: "signed-in",
    userId: data.user.id,
    email: data.user.email ?? null,
  };
}

export async function hasServerSession() {
  const session = await getServerSession();
  return session.status === "signed-in";
}
