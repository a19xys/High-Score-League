import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getRealLeagueChatMessages,
  mapLeagueChatRowToMessage,
} from "@/lib/data/league-chat";
import type { LeagueChatMessageRow } from "@/types/supabase";

const chatMessageMaxLength = 65_536;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function validateContent(value: unknown) {
  if (typeof value !== "string") {
    return { ok: false as const, error: "content es obligatorio." };
  }

  const content = value.trim();

  if (!content) {
    return { ok: false as const, error: "El mensaje no puede estar vacío." };
  }

  if (content.length > chatMessageMaxLength) {
    return {
      ok: false as const,
      error: "El mensaje no puede superar 65.536 caracteres.",
    };
  }

  return { ok: true as const, content };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("No se pudo cargar el chat. Prueba a recargar la página.", 500);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas iniciar sesión para leer el chat.", 401);
  }

  const result = await getRealLeagueChatMessages();

  if (result.error) {
    console.error("Chat read failed", result.error);
    return jsonError("No se pudo cargar el chat. Prueba a recargar la página.", 500);
  }

  return NextResponse.json({ ok: true, messages: result.rows });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("No se pudo enviar el mensaje. Inténtalo de nuevo.", 500);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("El payload debe ser JSON válido.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonError("El payload debe ser un objeto JSON.");
  }

  const record = payload as Record<string, unknown>;

  if ("authorId" in record) {
    return jsonError("authorId no se acepta desde cliente.");
  }

  if ("messageType" in record) {
    return jsonError("messageType no se acepta desde cliente.");
  }

  const content = validateContent(record.content);

  if (!content.ok) {
    return jsonError(content.error);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas iniciar sesión para escribir en el chat.", 401);
  }

  const { data: message, error } = await supabase
    .from("league_chat_messages")
    .insert({
      message_type: "user",
      author_id: userData.user.id,
      content: content.content,
    })
    .select(
      `
        id,
        message_type,
        author_id,
        content,
        created_at,
        profiles:author_id (
          id,
          username,
          initials,
          avatar_url,
          is_admin,
          created_at,
          updated_at
        )
      `,
    )
    .single();

  if (error) {
    console.error("Chat insert failed", error);
    return jsonError("No se pudo enviar el mensaje. Inténtalo de nuevo.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      message: mapLeagueChatRowToMessage(message as LeagueChatMessageRow),
    },
    { status: 201 },
  );
}
