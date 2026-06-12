import type { SupabaseClient } from "@supabase/supabase-js";
import {
  homePollColumns,
  homePollOptionColumns,
} from "@/lib/admin/home-polls";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PublicHomePoll } from "@/types";
import type {
  HomePollOptionRow,
  HomePollRow,
  HomePollVoteRow,
} from "@/types/supabase";

type ClientPair = {
  userClient: SupabaseClient;
  adminClient?: SupabaseClient | null;
};

function getReadClient({ userClient, adminClient }: ClientPair) {
  return adminClient ?? userClient;
}

function buildStats(
  options: HomePollOptionRow[],
  votes: HomePollVoteRow[],
) {
  const totalVotes = votes.length;
  const votesByOption = new Map<string, number>();

  for (const vote of votes) {
    votesByOption.set(vote.option_id, (votesByOption.get(vote.option_id) ?? 0) + 1);
  }

  return {
    totalVotes,
    options: options.map((option) => {
      const optionVotes = votesByOption.get(option.id) ?? 0;

      return {
        id: option.id,
        label: option.label,
        imageUrl: option.image_url,
        sortOrder: option.sort_order,
        votes: optionVotes,
        percentage:
          totalVotes > 0 ? Math.round((optionVotes / totalVotes) * 100) : 0,
      };
    }),
  };
}

async function getVisiblePollRows(client: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: poll, error: pollError } = await client
    .from("home_polls")
    .select(homePollColumns)
    .eq("singleton_key", true)
    .eq("enabled", true)
    .gt("closes_at", now)
    .maybeSingle<HomePollRow>();

  if (pollError || !poll || !poll.question.trim() || !poll.closes_at) {
    return { poll: null, options: [], error: pollError?.message ?? null };
  }

  const { data: options, error: optionsError } = await client
    .from("home_poll_options")
    .select(homePollOptionColumns)
    .eq("poll_id", poll.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (optionsError) {
    return { poll: null, options: [], error: optionsError.message };
  }

  const optionRows = (options ?? []) as HomePollOptionRow[];

  if (optionRows.length < 2) {
    return { poll: null, options: [], error: null };
  }

  return { poll, options: optionRows, error: null };
}

export async function getPublicHomePoll(
  userClient: SupabaseClient,
  userId: string,
): Promise<{ poll: PublicHomePoll | null; error: string | null }> {
  const adminClient = createSupabaseAdminClient();
  const readClient = getReadClient({ userClient, adminClient });
  const visible = await getVisiblePollRows(readClient);

  if (visible.error || !visible.poll) {
    return { poll: null, error: visible.error };
  }

  const closesAt = visible.poll.closes_at;

  if (!closesAt) {
    return { poll: null, error: null };
  }

  const { data: ownVote, error: ownVoteError } = await readClient
    .from("home_poll_votes")
    .select("id,poll_id,option_id,player_id,created_at,updated_at")
    .eq("poll_id", visible.poll.id)
    .eq("player_id", userId)
    .maybeSingle<HomePollVoteRow>();

  if (ownVoteError) {
    return { poll: null, error: ownVoteError.message };
  }

  if (!ownVote) {
    return {
      poll: {
        id: visible.poll.id,
        question: visible.poll.question,
        closesAt,
        options: visible.options.map((option) => ({
          id: option.id,
          label: option.label,
          imageUrl: option.image_url,
          sortOrder: option.sort_order,
        })),
        selectedOptionId: null,
        hasVoted: false,
      },
      error: null,
    };
  }

  if (!adminClient) {
    return {
      poll: {
        id: visible.poll.id,
        question: visible.poll.question,
        closesAt,
        options: visible.options.map((option) => ({
          id: option.id,
          label: option.label,
          imageUrl: option.image_url,
          sortOrder: option.sort_order,
        })),
        selectedOptionId: ownVote.option_id,
        hasVoted: true,
        totalVotes: undefined,
      },
      error: null,
    };
  }

  const { data: votes, error: votesError } = await adminClient
    .from("home_poll_votes")
    .select("id,poll_id,option_id,player_id,created_at,updated_at")
    .eq("poll_id", visible.poll.id);

  if (votesError) {
    return { poll: null, error: votesError.message };
  }

  const stats = buildStats(visible.options, (votes ?? []) as HomePollVoteRow[]);

  return {
    poll: {
      id: visible.poll.id,
      question: visible.poll.question,
      closesAt,
      options: stats.options,
      selectedOptionId: ownVote.option_id,
      hasVoted: true,
      totalVotes: stats.totalVotes,
    },
    error: null,
  };
}

export async function votePublicHomePoll(
  userClient: SupabaseClient,
  userId: string,
  optionId: string,
) {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return {
      ok: false,
      status: 500,
      error: "No se pudo preparar la votación.",
    };
  }

  const visible = await getVisiblePollRows(adminClient);

  if (visible.error) {
    return { ok: false, status: 500, error: "No se pudo cargar el cuestionario." };
  }

  if (!visible.poll) {
    return { ok: false, status: 404, error: "No hay cuestionario disponible." };
  }

  if (!visible.options.some((option) => option.id === optionId)) {
    return { ok: false, status: 400, error: "La opción no pertenece al cuestionario." };
  }

  const { error } = await adminClient.from("home_poll_votes").upsert(
    {
      poll_id: visible.poll.id,
      option_id: optionId,
      player_id: userId,
    },
    { onConflict: "poll_id,player_id" },
  );

  if (error) {
    return { ok: false, status: 500, error: "No se pudo registrar el voto." };
  }

  const updated = await getPublicHomePoll(userClient, userId);

  if (updated.error || !updated.poll) {
    return { ok: false, status: 500, error: "No se pudo cargar el resultado." };
  }

  return { ok: true, poll: updated.poll };
}
