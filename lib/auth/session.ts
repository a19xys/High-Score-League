import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveServerSession, type ServerSession } from "./server-session";
export { resolveServerSession, type ServerSession } from "./server-session";

export async function getServerSession(): Promise<ServerSession> {
  const supabase = await createSupabaseServerClient();
  return resolveServerSession(supabase?.auth ?? null);
}

export async function hasServerSession() {
  const session = await getServerSession();
  return session.status === "signed-in";
}
