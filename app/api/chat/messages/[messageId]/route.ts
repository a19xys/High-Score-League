import { type NextRequest, NextResponse } from "next/server";
import { mapLeagueChatRowToMessage } from "@/lib/data/league-chat";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LeagueChatMessageRow } from "@/types/supabase";

const chatMessageMaxLength = 65_536;
const editWindowMs = 15 * 60 * 1000;
const notEditableMessage =
  "Solo puedes editar tu ultimo mensaje durante 15 minutos.";

type RouteContext = {
  params: Promise<{
    messageId: string;
  }>;
};

type ChatMessageEditRow = {
  id: string;
  message_type: "user" | "system";
  author_id: string | null;
  content: string;
  created_at: string;
  edited_at: string | null;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function jsonCodeError(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function validateContent(value: unknown) {
  if (typeof value !== "string") {
    return { ok: false as const, error: "content es obligatorio." };
  }

  const content = value.trim();

  if (!content) {
    return { ok: false as const, error: "El mensaje no puede estar vacio." };
  }

  if (content.length > chatMessageMaxLength) {
    return {
      ok: false as const,
      error: "El mensaje no puede superar 65.536 caracteres.",
    };
  }

  return { ok: true as const, content };
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("No se pudo editar el mensaje. Intentalo de nuevo.", 500);
  }

  const { messageId } = await params;
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("El payload debe ser JSON valido.");
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

  if ("createdAt" in record) {
    return jsonError("createdAt no se acepta desde cliente.");
  }

  if ("editedAt" in record) {
    return jsonError("editedAt no se acepta desde cliente.");
  }

  const content = validateContent(record.content);

  if (!content.ok) {
    return jsonError(content.error);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas iniciar sesion para editar el chat.", 401);
  }

  const { data: existingMessage, error: existingError } = await supabase
    .from("league_chat_messages")
    .select("id,message_type,author_id,content,created_at,edited_at")
    .eq("id", messageId)
    .maybeSingle<ChatMessageEditRow>();

  if (existingError) {
    console.error("Chat message edit read failed", existingError);
    return jsonError("No se pudo editar el mensaje. Intentalo de nuevo.", 500);
  }

  if (!existingMessage) {
    return jsonCodeError("MESSAGE_NOT_FOUND", "Mensaje no encontrado.", 404);
  }

  const createdAtMs = new Date(existingMessage.created_at).getTime();
  const insideEditWindow =
    Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= editWindowMs;

  if (
    existingMessage.message_type !== "user" ||
    existingMessage.author_id !== userData.user.id ||
    !insideEditWindow
  ) {
    return jsonCodeError("MESSAGE_NOT_EDITABLE", notEditableMessage, 403);
  }

  const { data: latestOwnMessage, error: latestOwnError } = await supabase
    .from("league_chat_messages")
    .select("id")
    .eq("message_type", "user")
    .eq("author_id", userData.user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (latestOwnError) {
    console.error("Latest own chat message read failed", latestOwnError);
    return jsonError("No se pudo editar el mensaje. Intentalo de nuevo.", 500);
  }

  if (!latestOwnMessage || latestOwnMessage.id !== existingMessage.id) {
    return jsonCodeError("MESSAGE_NOT_EDITABLE", notEditableMessage, 403);
  }

  const { data: updatedMessage, error: updateError } = await supabase
    .from("league_chat_messages")
    .update({
      content: content.content,
      edited_at: new Date().toISOString(),
    })
    .eq("id", existingMessage.id)
    .select(
      `
        id,
        message_type,
        author_id,
        content,
        created_at,
        edited_at,
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

  if (updateError) {
    console.error("Chat message update failed", updateError);
    return jsonError("No se pudo editar el mensaje. Intentalo de nuevo.", 500);
  }

  return NextResponse.json({
    ok: true,
    message: mapLeagueChatRowToMessage(updatedMessage as LeagueChatMessageRow),
  });
}
