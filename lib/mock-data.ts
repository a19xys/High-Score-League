import type {
  Game,
  LeaderboardEntry,
  Player,
  Season,
  SeasonStanding,
  Submission,
  Week,
} from "@/types";

export const players: Player[] = [
  { id: "p1", username: "lauravc", initials: "LVC", isAdmin: true },
  { id: "p2", username: "mariosn", initials: "MSN", isAdmin: false },
  { id: "p3", username: "nicorms", initials: "NRM", isAdmin: false },
  { id: "p4", username: "claradz", initials: "CDZ", isAdmin: false },
  { id: "p5", username: "hugomln", initials: "HML", isAdmin: false },
];

export const games: Game[] = [
  {
    id: "g1",
    title: "Galaga",
    slug: "galaga",
    genre: "Fixed shooter",
    imageAlt: "Placeholder arcade cabinet for Galaga week",
  },
  {
    id: "g2",
    title: "Donkey Kong",
    slug: "donkey-kong",
    genre: "Platform",
    imageAlt: "Placeholder arcade cabinet for Donkey Kong week",
  },
  {
    id: "g3",
    title: "Pac-Man",
    slug: "pac-man",
    genre: "Maze",
    imageAlt: "Placeholder arcade cabinet for Pac-Man week",
  },
  {
    id: "g4",
    title: "Out Run",
    slug: "out-run",
    genre: "Racing",
    imageAlt: "Placeholder arcade cabinet for Out Run week",
  },
  {
    id: "g5",
    title: "Bubble Bobble",
    slug: "bubble-bobble",
    genre: "Platform",
    imageAlt: "Placeholder arcade cabinet for Bubble Bobble week",
  },
  {
    id: "g6",
    title: "Metal Slug",
    slug: "metal-slug",
    genre: "Run and gun",
    imageAlt: "Placeholder arcade cabinet for Metal Slug week",
  },
  {
    id: "g7",
    title: "Street Fighter II",
    slug: "street-fighter-ii",
    genre: "Fighting",
    imageAlt: "Placeholder arcade cabinet for Street Fighter II week",
  },
  {
    id: "g8",
    title: "Tetris",
    slug: "tetris",
    genre: "Puzzle",
    imageAlt: "Placeholder arcade cabinet for Tetris week",
  },
];

export const currentSeason: Season = {
  id: "s1",
  name: "Temporada I",
  startsAt: "2026-05-18T00:00:00.000Z",
  endsAt: "2026-07-12T23:59:59.000Z",
  weekCount: 8,
};

export const weeks: Week[] = [
  {
    id: "w1",
    seasonId: "s1",
    gameId: "g1",
    number: 1,
    startsAt: "2026-05-18T00:00:00.000Z",
    endsAt: "2026-05-24T23:59:59.000Z",
    revealAt: "2026-05-25T20:00:00.000Z",
    manualUrl: "/manuals/galaga-week-1.pdf",
    status: "active",
    rules: [
      "Una sola partida por subida.",
      "La captura debe mostrar puntuación final y siglas del jugador.",
      "Se permite jugar en hardware original, MiSTer o emulador con defaults.",
      "Puedes subir varias puntuaciones válidas durante la semana.",
      "Empates resueltos por primera subida válida.",
    ],
  },
  {
    id: "w2",
    seasonId: "s1",
    gameId: "g2",
    number: 2,
    startsAt: "2026-05-25T00:00:00.000Z",
    endsAt: "2026-05-31T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-06-01T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w3",
    seasonId: "s1",
    gameId: "g3",
    number: 3,
    startsAt: "2026-06-01T00:00:00.000Z",
    endsAt: "2026-06-07T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-06-08T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w4",
    seasonId: "s1",
    gameId: "g4",
    number: 4,
    startsAt: "2026-06-08T00:00:00.000Z",
    endsAt: "2026-06-14T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-06-15T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w5",
    seasonId: "s1",
    gameId: "g5",
    number: 5,
    startsAt: "2026-06-15T00:00:00.000Z",
    endsAt: "2026-06-21T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-06-22T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w6",
    seasonId: "s1",
    gameId: "g6",
    number: 6,
    startsAt: "2026-06-22T00:00:00.000Z",
    endsAt: "2026-06-28T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-06-29T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w7",
    seasonId: "s1",
    gameId: "g7",
    number: 7,
    startsAt: "2026-06-29T00:00:00.000Z",
    endsAt: "2026-07-05T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-07-06T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w8",
    seasonId: "s1",
    gameId: "g8",
    number: 8,
    startsAt: "2026-07-06T00:00:00.000Z",
    endsAt: "2026-07-12T23:59:59.000Z",
    status: "closed",
    revealAt: "2026-07-13T20:00:00.000Z",
    rules: ["Pendiente de publicar."],
  },
];

export const currentWeek = weeks[0];

export const submissions: Submission[] = [
  {
    id: "sub1",
    weekId: "w1",
    playerId: "p1",
    score: 184320,
    screenshotUrl: "/mock/laura-galaga.png",
    comment: "Primer intento serio de la semana.",
    createdAt: "2026-05-19T20:12:00.000Z",
    valid: true,
  },
  {
    id: "sub2",
    weekId: "w1",
    playerId: "p2",
    score: 172040,
    screenshotUrl: "/mock/mario-galaga.png",
    createdAt: "2026-05-20T18:45:00.000Z",
    valid: true,
  },
  {
    id: "sub3",
    weekId: "w1",
    playerId: "p3",
    score: 171700,
    screenshotUrl: "/mock/nico-galaga.png",
    createdAt: "2026-05-21T22:08:00.000Z",
    valid: true,
  },
  {
    id: "sub4",
    weekId: "w1",
    playerId: "p1",
    score: 160200,
    screenshotUrl: "/mock/laura-galaga-early.png",
    createdAt: "2026-05-18T21:18:00.000Z",
    valid: true,
  },
  {
    id: "sub5",
    weekId: "w1",
    playerId: "p4",
    score: 149880,
    screenshotUrl: "/mock/clara-galaga.png",
    createdAt: "2026-05-22T19:27:00.000Z",
    valid: true,
  },
  {
    id: "sub6",
    weekId: "w1",
    playerId: "p5",
    score: 132410,
    screenshotUrl: "/mock/hugo-galaga.png",
    createdAt: "2026-05-21T16:51:00.000Z",
    valid: true,
  },
];

type SeasonStandingInput = Omit<SeasonStanding, "rank" | "positionChange"> & {
  previousRank: number;
};

const seasonStandingInputs: SeasonStandingInput[] = [
  {
    player: players[0],
    totalPoints: 12,
    previousRank: 4,
    firstPlaces: 1,
    secondPlaces: 0,
    thirdPlaces: 1,
    weeksPlayed: 2,
  },
  {
    player: players[1],
    totalPoints: 10,
    previousRank: 2,
    firstPlaces: 0,
    secondPlaces: 1,
    thirdPlaces: 1,
    weeksPlayed: 2,
  },
  {
    player: players[2],
    totalPoints: 10,
    previousRank: 3,
    firstPlaces: 0,
    secondPlaces: 1,
    thirdPlaces: 1,
    weeksPlayed: 2,
  },
  {
    player: players[3],
    totalPoints: 6,
    previousRank: 1,
    firstPlaces: 0,
    secondPlaces: 0,
    thirdPlaces: 0,
    weeksPlayed: 2,
  },
  {
    player: players[4],
    totalPoints: 3,
    previousRank: 5,
    firstPlaces: 0,
    secondPlaces: 0,
    thirdPlaces: 0,
    weeksPlayed: 2,
  },
];

function compareSeasonCriteria(
  a: SeasonStandingInput,
  b: SeasonStandingInput,
) {
  return (
    b.totalPoints - a.totalPoints ||
    b.firstPlaces - a.firstPlaces ||
    b.secondPlaces - a.secondPlaces ||
    b.thirdPlaces - a.thirdPlaces
  );
}

function hasSameSeasonCriteria(
  a: SeasonStandingInput,
  b: SeasonStandingInput,
) {
  return compareSeasonCriteria(a, b) === 0;
}

const sortedSeasonStandingInputs = [...seasonStandingInputs].sort((a, b) => {
    const competitiveOrder = compareSeasonCriteria(a, b);

    if (competitiveOrder !== 0) {
      return competitiveOrder;
    }

    return a.player.username.localeCompare(b.player.username);
  });

export const seasonStandings: SeasonStanding[] =
  sortedSeasonStandingInputs.reduce<SeasonStanding[]>((standings, standing, index) => {
    const previousInput = sortedSeasonStandingInputs[index - 1];
    const previousStanding = standings[index - 1];
    const rank =
      previousInput && previousStanding && hasSameSeasonCriteria(standing, previousInput)
        ? previousStanding.rank
        : index + 1;

    const { previousRank, ...seasonStanding } = standing;

    standings.push({
      ...seasonStanding,
      rank,
      positionChange: previousRank - rank,
    });

    return standings;
  }, []);

export function getCurrentGame() {
  return games.find((game) => game.id === currentWeek.gameId) ?? games[0];
}

export function getWeeklyLeaderboard(weekId = currentWeek.id): LeaderboardEntry[] {
  const validSubmissions = submissions.filter(
    (submission) => submission.weekId === weekId && submission.valid,
  );

  const entries = players
    .map((player) => {
      const playerSubmissions = validSubmissions.filter(
        (submission) => submission.playerId === player.id,
      );

      if (playerSubmissions.length === 0) {
        return null;
      }

      const bestScore = Math.max(
        ...playerSubmissions.map((submission) => submission.score),
      );
      const lastSubmissionAt = playerSubmissions
        .map((submission) => submission.createdAt)
        .sort()
        .at(-1) as string;

      return {
        player,
        bestScore,
        uploads: playerSubmissions.length,
        lastSubmissionAt,
      };
    })
    .filter((entry): entry is Omit<LeaderboardEntry, "rank" | "gapToFirst"> =>
      Boolean(entry),
    )
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) {
        return b.bestScore - a.bestScore;
      }

      return a.lastSubmissionAt.localeCompare(b.lastSubmissionAt);
    });

  const firstScore = entries[0]?.bestScore ?? 0;

  return entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    gapToFirst: firstScore - entry.bestScore,
  }));
}

export function getRecentSubmissions(limit = 5) {
  return [...submissions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((submission) => ({
      ...submission,
      player: players.find((player) => player.id === submission.playerId),
    }));
}
