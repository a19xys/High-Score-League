import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LeagueChatMessage } from "@/types";
import type { LeagueChatMessageRow, RealProfile } from "@/types/supabase";
import { mapRealProfileToPlayer } from "./submissions";
import type { DataReadResult } from "./types";

const chatMessageColumns = `
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
`;

function normalizeProfile(profile: RealProfile | RealProfile[] | null | undefined) {
  return Array.isArray(profile) ? profile[0] : profile;
}

export function mapLeagueChatRowToMessage(
  row: LeagueChatMessageRow,
): LeagueChatMessage {
  const profile = normalizeProfile(row.profiles);

  return {
    id: row.id,
    messageType: row.message_type,
    authorId: row.author_id,
    content: row.content,
    createdAt: row.created_at,
    author: profile ? mapRealProfileToPlayer(profile) : null,
  };
}

export async function getRealLeagueChatMessages(): Promise<
  DataReadResult<LeagueChatMessage>
> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      rows: [],
      source: "supabase",
      error: "Supabase no está configurado.",
      usingFallback: false,
    };
  }

  const { data, error } = await supabase
    .from("league_chat_messages")
    .select(chatMessageColumns)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  if (error) {
    return {
      rows: [],
      source: "supabase",
      error: error.message,
      usingFallback: false,
    };
  }

  return {
    rows: ((data ?? []) as LeagueChatMessageRow[])
      .map(mapLeagueChatRowToMessage)
      .reverse(),
    source: "supabase",
    error: null,
    usingFallback: false,
  };
}
