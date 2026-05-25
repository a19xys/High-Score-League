import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase no esta configurado." },
      { status: 500 },
    );
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json(
      { error: "Necesitas iniciar sesion para borrar la cuenta." },
      { status: 401 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "Falta SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor. No se puede borrar la cuenta.",
      },
      { status: 500 },
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(
    userData.user.id,
  );

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message },
      { status: 500 },
    );
  }

  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
