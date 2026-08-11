import type { PlayerProfileSubmission } from "@/lib/data/player-profile";

export const ALL_PROFILE_GAMES = "all";

export type ProfileSubmissionGameOption = {
  id: string;
  title: string;
  latestSubmissionAt: string;
};

function getSubmissionGameId(submission: PlayerProfileSubmission) {
  return submission.game?.id ?? submission.week?.gameId ?? null;
}

export function getProfileSubmissionGameOptions(
  submissions: PlayerProfileSubmission[],
): ProfileSubmissionGameOption[] {
  const byGame = new Map<string, ProfileSubmissionGameOption>();

  for (const submission of submissions) {
    const gameId = getSubmissionGameId(submission);

    if (!gameId) {
      continue;
    }

    const existing = byGame.get(gameId);

    if (!existing || submission.createdAt > existing.latestSubmissionAt) {
      byGame.set(gameId, {
        id: gameId,
        title: submission.game?.title ?? "Juego no disponible",
        latestSubmissionAt: submission.createdAt,
      });
    }
  }

  return Array.from(byGame.values()).sort((a, b) =>
    b.latestSubmissionAt.localeCompare(a.latestSubmissionAt),
  );
}

export function getDefaultProfileSubmissionGame(
  submissions: PlayerProfileSubmission[],
) {
  return getProfileSubmissionGameOptions(submissions)[0]?.id ?? ALL_PROFILE_GAMES;
}

export function filterProfileSubmissionsByGame(
  submissions: PlayerProfileSubmission[],
  gameId: string,
) {
  if (gameId === ALL_PROFILE_GAMES) {
    return submissions;
  }

  return submissions.filter(
    (submission) => getSubmissionGameId(submission) === gameId,
  );
}
