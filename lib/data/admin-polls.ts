import type { SupabaseClient } from "@supabase/supabase-js";
import {
  homePollColumns,
  homePollOptionColumns,
  mapHomePollOptionRow,
  mapHomePollRow,
  type ValidatedHomePollInput,
} from "@/lib/admin/home-polls";
import type { HomePollAdminData } from "@/types";
import type {
  HomePollOptionRow,
  HomePollRow,
  HomePollVoteRow,
} from "@/types/supabase";

async function selectSingletonPoll(supabase: SupabaseClient) {
  return supabase
    .from("home_polls")
    .select(homePollColumns)
    .eq("singleton_key", true)
    .maybeSingle<HomePollRow>();
}

export async function ensureAdminHomePoll(supabase: SupabaseClient) {
  const existing = await selectSingletonPoll(supabase);

  if (existing.error) {
    return { row: null, error: existing.error.message };
  }

  if (existing.data) {
    return { row: existing.data, error: null };
  }

  const created = await supabase
    .from("home_polls")
    .insert({ singleton_key: true, question: "", enabled: false })
    .select(homePollColumns)
    .single<HomePollRow>();

  if (created.error) {
    const retry = await selectSingletonPoll(supabase);

    if (retry.data && !retry.error) {
      return { row: retry.data, error: null };
    }

    return { row: null, error: created.error.message };
  }

  return { row: created.data, error: null };
}

export async function getAdminHomePoll(
  supabase: SupabaseClient,
): Promise<{ data: HomePollAdminData | null; error: string | null }> {
  const pollResult = await ensureAdminHomePoll(supabase);

  if (pollResult.error || !pollResult.row) {
    return { data: null, error: pollResult.error ?? "No se pudo cargar el cuestionario." };
  }

  const [optionsResult, votesResult] = await Promise.all([
    supabase
      .from("home_poll_options")
      .select(homePollOptionColumns)
      .eq("poll_id", pollResult.row.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("home_poll_votes")
      .select("id,poll_id,option_id,player_id,created_at,updated_at")
      .eq("poll_id", pollResult.row.id),
  ]);

  const error = optionsResult.error ?? votesResult.error;

  if (error) {
    return { data: null, error: error.message };
  }

  const options = ((optionsResult.data ?? []) as HomePollOptionRow[]).map(
    mapHomePollOptionRow,
  );
  const voteRows = (votesResult.data ?? []) as HomePollVoteRow[];
  const totalVotes = voteRows.length;
  const votesByOption = new Map<string, number>();

  for (const vote of voteRows) {
    votesByOption.set(vote.option_id, (votesByOption.get(vote.option_id) ?? 0) + 1);
  }

  return {
    data: {
      poll: mapHomePollRow(pollResult.row),
      options,
      totalVotes,
      stats: options.map((option) => {
        const votes = votesByOption.get(option.id) ?? 0;

        return {
          option,
          votes,
          percentage: totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0,
        };
      }),
    },
    error: null,
  };
}

export async function saveAdminHomePoll(
  supabase: SupabaseClient,
  input: ValidatedHomePollInput,
) {
  const pollResult = await ensureAdminHomePoll(supabase);

  if (pollResult.error || !pollResult.row) {
    return { ok: false, error: pollResult.error ?? "No se pudo cargar el cuestionario." };
  }

  const pollId = pollResult.row.id;
  const { error: pollError } = await supabase
    .from("home_polls")
    .update({
      question: input.question,
      closes_at: input.closes_at,
      enabled: input.enabled,
    })
    .eq("id", pollId);

  if (pollError) {
    return { ok: false, error: "No se pudo guardar el cuestionario." };
  }

  const existingResult = await supabase
    .from("home_poll_options")
    .select(homePollOptionColumns)
    .eq("poll_id", pollId);

  if (existingResult.error) {
    return { ok: false, error: "No se pudieron cargar las opciones actuales." };
  }

  const existing = ((existingResult.data ?? []) as HomePollOptionRow[]);
  const existingIds = new Set(existing.map((option) => option.id));
  const incomingIds = new Set(
    input.options.map((option) => option.id).filter(Boolean) as string[],
  );
  const idsToDelete = existing
    .map((option) => option.id)
    .filter((id) => !incomingIds.has(id));

  if (idsToDelete.length > 0) {
    const { error } = await supabase
      .from("home_poll_options")
      .delete()
      .eq("poll_id", pollId)
      .in("id", idsToDelete);

    if (error) {
      return { ok: false, error: "No se pudieron eliminar opciones." };
    }
  }

  for (const option of input.options) {
    if (option.id && existingIds.has(option.id)) {
      const { error } = await supabase
        .from("home_poll_options")
        .update({ label: option.label, sort_order: option.sort_order })
        .eq("poll_id", pollId)
        .eq("id", option.id);

      if (error) {
        return { ok: false, error: "No se pudo actualizar una opción." };
      }

      continue;
    }

    const { error } = await supabase.from("home_poll_options").insert({
      poll_id: pollId,
      label: option.label,
      sort_order: option.sort_order,
    });

    if (error) {
      return { ok: false, error: "No se pudo crear una opción." };
    }
  }

  return { ok: true };
}

export async function resetAdminHomePoll(supabase: SupabaseClient) {
  const pollResult = await ensureAdminHomePoll(supabase);

  if (pollResult.error || !pollResult.row) {
    return { ok: false, error: pollResult.error ?? "No se pudo cargar el cuestionario." };
  }

  const pollId = pollResult.row.id;
  const deleteOptions = await supabase
    .from("home_poll_options")
    .delete()
    .eq("poll_id", pollId);

  if (deleteOptions.error) {
    return { ok: false, error: "No se pudieron borrar las opciones." };
  }

  const updatePoll = await supabase
    .from("home_polls")
    .update({
      question: "",
      closes_at: null,
      enabled: false,
    })
    .eq("id", pollId);

  if (updatePoll.error) {
    return { ok: false, error: "No se pudo reiniciar el cuestionario." };
  }

  return { ok: true };
}
