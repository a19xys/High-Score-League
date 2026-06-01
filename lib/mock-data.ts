import type {
  Game,
  ChatMessage,
  ChatMessageWithPlayer,
  LeaderboardEntry,
  Player,
  Season,
  SeasonStanding,
  SeasonSummary,
  Submission,
  Week,
  WeekSummary,
} from "@/types";

export const players: Player[] = [
  {
    id: "p1",
    username: "lauravc",
    initials: "LVC",
    bio: "Apasionada de los juegos de puzles que odia los juegos de puzles.",
    isAdmin: true,
  },
  {
    id: "p2",
    username: "mariosn",
    initials: "MSN",
    bio: "Especialista en empezar fuerte y prometer que esta vez no improvisa.",
    isAdmin: false,
  },
  {
    id: "p3",
    username: "nicorms",
    initials: "NRM",
    bio: "Busca rutas limpias, patrones raros y excusas aceptables para reiniciar.",
    isAdmin: false,
  },
  {
    id: "p4",
    username: "claradz",
    initials: "CDZ",
    bio: "Juega con calma hasta que aparece una tabla de récords.",
    isAdmin: false,
  },
  {
    id: "p5",
    username: "hugomln",
    initials: "HML",
    bio: "Defensor del crédito único y de mirar las instrucciones demasiado tarde.",
    isAdmin: false,
  },
  {
    id: "p6",
    username: "alex_87",
    initials: "A87",
    bio: "Viene por la nostalgia y se queda por los empates imposibles.",
    isAdmin: false,
  },
  {
    id: "p7",
    username: "saratpx",
    initials: "STX",
    bio: "Prefiere partidas cortas, decisiones rápidas y capturas bien enfocadas.",
    isAdmin: false,
  },
];

export const games: Game[] = [
  {
    id: "g1",
    title: "Galaga",
    slug: "galaga",
    developer: "Namco",
    genre: "Fixed shooter",
    controlType: "estándar",
    difficulty: "media",
    imageAlt: "Placeholder arcade cabinet for Galaga week",
  },
  {
    id: "g2",
    title: "Donkey Kong",
    slug: "donkey-kong",
    developer: "Nintendo",
    genre: "Plataformas",
    controlType: "estándar",
    difficulty: "alta",
    imageAlt: "Placeholder arcade cabinet for Donkey Kong week",
  },
  {
    id: "g3",
    title: "Pac-Man",
    slug: "pac-man",
    developer: "Namco",
    genre: "Laberinto",
    controlType: "estándar",
    difficulty: "media",
    imageAlt: "Placeholder arcade cabinet for Pac-Man week",
  },
  {
    id: "g4",
    title: "Out Run",
    slug: "out-run",
    developer: "Sega",
    genre: "Conducción",
    controlType: "volante",
    difficulty: "media",
    imageAlt: "Placeholder arcade cabinet for Out Run week",
  },
  {
    id: "g5",
    title: "Bubble Bobble",
    slug: "bubble-bobble",
    developer: "Taito",
    genre: "Plataformas",
    controlType: "botones rápidos",
    difficulty: "baja",
    imageAlt: "Placeholder arcade cabinet for Bubble Bobble week",
  },
  {
    id: "g6",
    title: "Metal Slug",
    slug: "metal-slug",
    developer: "Nazca",
    genre: "Run and gun",
    controlType: "botones rápidos",
    difficulty: "alta",
    imageAlt: "Placeholder arcade cabinet for Metal Slug week",
  },
  {
    id: "g7",
    title: "Street Fighter II",
    slug: "street-fighter-ii",
    developer: "Capcom",
    genre: "Lucha",
    controlType: "botones rápidos",
    difficulty: "alta",
    imageAlt: "Placeholder arcade cabinet for Street Fighter II week",
  },
  {
    id: "g8",
    title: "Tetris",
    slug: "tetris",
    developer: "Atari Games",
    genre: "Puzzle",
    controlType: "estándar",
    difficulty: "media",
    imageAlt: "Placeholder arcade cabinet for Tetris week",
  },
  {
    id: "g9",
    title: "Centipede",
    slug: "centipede",
    developer: "Atari",
    genre: "Shooter",
    controlType: "trackball",
    difficulty: "media",
    imageAlt: "Placeholder arcade cabinet for Centipede week",
  },
  {
    id: "g10",
    title: "Robotron: 2084",
    slug: "robotron-2084",
    developer: "Williams",
    genre: "Arena shooter",
    controlType: "doble stick",
    difficulty: "alta",
    imageAlt: "Placeholder arcade cabinet for Robotron week",
  },
  {
    id: "g11",
    title: "Arkanoid",
    slug: "arkanoid",
    developer: "Taito",
    genre: "Breakout",
    controlType: "spinner",
    difficulty: "media",
    imageAlt: "Placeholder arcade cabinet for Arkanoid week",
  },
  {
    id: "g12",
    title: "Paperboy",
    slug: "paperboy",
    developer: "Atari Games",
    genre: "Acción",
    controlType: "control especial",
    difficulty: "alta",
    imageAlt: "Placeholder arcade cabinet for Paperboy week",
  },
];

export const seasons: Season[] = [
  {
    id: "s1",
    name: "Temporada I",
    slug: "temporada-i",
    version: "MVP",
    status: "active",
    startsAt: "2026-05-18T00:00:00+02:00",
    endsAt: "2026-07-12T23:59:00+02:00",
    weekCount: 8,
    leaderId: "p1",
  },
  {
    id: "s0",
    name: "Pretemporada",
    slug: "pretemporada",
    version: "Piloto",
    status: "completed",
    startsAt: "2026-04-06T00:00:00+02:00",
    endsAt: "2026-04-27T23:59:00+02:00",
    weekCount: 3,
    championId: "p2",
  },
  {
    id: "s2",
    name: "Temporada II",
    slug: "temporada-ii",
    version: "Planificada",
    status: "draft",
    startsAt: "2026-09-07T00:00:00+02:00",
    endsAt: "2026-11-01T23:59:00+01:00",
    weekCount: 8,
  },
];

export const currentSeason = seasons[0];

export const weeks: Week[] = [
  {
    id: "w1",
    seasonId: "s1",
    gameId: "g1",
    number: 1,
    startsAt: "2026-05-18T00:00:00+02:00",
    endsAt: "2026-05-24T23:59:00+02:00",
    revealAt: "2026-05-25T00:00:00+02:00",
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
    startsAt: "2026-05-25T00:00:00+02:00",
    endsAt: "2026-05-31T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-06-01T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w3",
    seasonId: "s1",
    gameId: "g3",
    number: 3,
    startsAt: "2026-06-01T00:00:00+02:00",
    endsAt: "2026-06-07T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-06-08T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w4",
    seasonId: "s1",
    gameId: "g4",
    number: 4,
    startsAt: "2026-06-08T00:00:00+02:00",
    endsAt: "2026-06-14T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-06-15T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w5",
    seasonId: "s1",
    gameId: "g5",
    number: 5,
    startsAt: "2026-06-15T00:00:00+02:00",
    endsAt: "2026-06-21T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-06-22T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w6",
    seasonId: "s1",
    gameId: "g6",
    number: 6,
    startsAt: "2026-06-22T00:00:00+02:00",
    endsAt: "2026-06-28T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-06-29T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w7",
    seasonId: "s1",
    gameId: "g7",
    number: 7,
    startsAt: "2026-06-29T00:00:00+02:00",
    endsAt: "2026-07-05T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-07-06T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "w8",
    seasonId: "s1",
    gameId: "g8",
    number: 8,
    startsAt: "2026-07-06T00:00:00+02:00",
    endsAt: "2026-07-12T23:59:00+02:00",
    status: "draft",
    revealAt: "2026-07-13T00:00:00+02:00",
    rules: ["Pendiente de publicar."],
  },
  {
    id: "p0w1",
    seasonId: "s0",
    gameId: "g9",
    number: 1,
    startsAt: "2026-04-06T00:00:00+02:00",
    endsAt: "2026-04-12T23:59:00+02:00",
    revealAt: "2026-04-13T00:00:00+02:00",
    status: "published",
    rules: ["Settings por defecto.", "Una sola vida inicial.", "Captura de pantalla final obligatoria."],
  },
  {
    id: "p0w2",
    seasonId: "s0",
    gameId: "g10",
    number: 2,
    startsAt: "2026-04-13T00:00:00+02:00",
    endsAt: "2026-04-19T23:59:00+02:00",
    revealAt: "2026-04-20T00:00:00+02:00",
    status: "published",
    rules: ["Dificultad por defecto.", "Se permite continuar solo desde inicio de partida."],
  },
  {
    id: "p0w3",
    seasonId: "s0",
    gameId: "g11",
    number: 3,
    startsAt: "2026-04-20T00:00:00+02:00",
    endsAt: "2026-04-26T23:59:00+02:00",
    revealAt: "2026-04-27T00:00:00+02:00",
    status: "closed",
    rules: ["Sin continues.", "Captura visible con puntuación y siglas."],
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
    createdAt: "2026-05-19T20:12:00+02:00",
    valid: true,
  },
  {
    id: "sub2",
    weekId: "w1",
    playerId: "p2",
    score: 172040,
    screenshotUrl: "/mock/mario-galaga.png",
    createdAt: "2026-05-20T18:45:00+02:00",
    valid: true,
  },
  {
    id: "sub3",
    weekId: "w1",
    playerId: "p3",
    score: 171700,
    screenshotUrl: "/mock/nico-galaga.png",
    createdAt: "2026-05-21T22:08:00+02:00",
    valid: true,
  },
  {
    id: "sub4",
    weekId: "w1",
    playerId: "p1",
    score: 160200,
    screenshotUrl: "/mock/laura-galaga-early.png",
    createdAt: "2026-05-18T21:18:00+02:00",
    valid: true,
  },
  {
    id: "sub5",
    weekId: "w1",
    playerId: "p4",
    score: 149880,
    screenshotUrl: "/mock/clara-galaga.png",
    createdAt: "2026-05-22T19:27:00+02:00",
    valid: true,
  },
  {
    id: "sub6",
    weekId: "w1",
    playerId: "p5",
    score: 132410,
    screenshotUrl: "/mock/hugo-galaga.png",
    createdAt: "2026-05-21T16:51:00+02:00",
    valid: true,
  },
  {
    id: "sub8",
    weekId: "w1",
    playerId: "p6",
    score: 128900,
    screenshotUrl: "/mock/alex-galaga.png",
    comment: "Primer contacto con la nave.",
    createdAt: "2026-05-22T21:04:00+02:00",
    valid: true,
  },
  {
    id: "sub9",
    weekId: "w1",
    playerId: "p7",
    score: 119550,
    screenshotUrl: "/mock/sara-galaga.png",
    createdAt: "2026-05-23T12:33:00+02:00",
    valid: true,
  },
  {
    id: "sub7",
    weekId: "w1",
    playerId: "p2",
    score: 191240,
    screenshotUrl: "/mock/mario-galaga-hidden.png",
    comment: "Guardada para la ventana oculta del fin de semana.",
    createdAt: "2026-05-23T23:12:00+02:00",
    valid: true,
    hidden: true,
  },
  {
    id: "sub10",
    weekId: "p0w1",
    playerId: "p2",
    score: 98210,
    screenshotUrl: "/mock/mario-centipede.png",
    createdAt: "2026-04-10T20:10:00+02:00",
    valid: true,
  },
  {
    id: "sub11",
    weekId: "p0w1",
    playerId: "p1",
    score: 90120,
    screenshotUrl: "/mock/laura-centipede.png",
    createdAt: "2026-04-11T18:35:00+02:00",
    valid: true,
  },
  {
    id: "sub12",
    weekId: "p0w2",
    playerId: "p4",
    score: 455300,
    screenshotUrl: "/mock/clara-robotron.png",
    createdAt: "2026-04-17T22:24:00+02:00",
    valid: true,
  },
  {
    id: "sub13",
    weekId: "p0w2",
    playerId: "p2",
    score: 431100,
    screenshotUrl: "/mock/mario-robotron.png",
    createdAt: "2026-04-18T19:51:00+02:00",
    valid: true,
  },
  {
    id: "sub14",
    weekId: "p0w3",
    playerId: "p7",
    score: 129880,
    screenshotUrl: "/mock/sara-arkanoid.png",
    createdAt: "2026-04-24T21:17:00+02:00",
    valid: true,
  },
];

export const chatMessages: ChatMessage[] = [
  {
    id: "chat1",
    playerId: "p4",
    body: "Semana 1 muy seria. Galaga no perdona.",
    createdAt: "2026-05-24T18:05:00+02:00",
  },
  {
    id: "chat2",
    playerId: "p1",
    body: "He dejado una puntuación decente, pero todavía hay margen.",
    createdAt: "2026-05-24T18:18:00+02:00",
  },
  {
    id: "chat3",
    playerId: "p2",
    body: "El lunes quiero ver ese leaderboard publicado.",
    createdAt: "2026-05-24T18:42:00+02:00",
  },
  {
    id: "chat4",
    playerId: "p3",
    body: "Me falta consistencia en la tercera fase.",
    createdAt: "2026-05-24T19:01:00+02:00",
  },
  {
    id: "chat5",
    playerId: "p5",
    body: "Confirmo que el mando cuenta más que el café.",
    createdAt: "2026-05-24T19:09:00+02:00",
  },
];

export const mockUser = players[0];

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

export function getGameById(gameId: string) {
  return games.find((game) => game.id === gameId);
}

export function getWeekById(weekId: string) {
  return weeks.find((week) => week.id === weekId);
}

export function getSeasonById(seasonId: string) {
  return seasons.find((season) => season.id === seasonId);
}

export function getCurrentGame() {
  return games.find((game) => game.id === currentWeek.gameId) ?? games[0];
}

export function getWeeklyLeaderboard(weekId = currentWeek.id): LeaderboardEntry[] {
  const week = getWeekById(weekId);
  const validSubmissions = submissions.filter(
    (submission) =>
      submission.weekId === weekId &&
      submission.valid &&
      (!submission.hidden || week?.status === "closed" || week?.status === "published"),
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
      week: weeks.find((week) => week.id === submission.weekId),
    }));
}

export function getSubmissionsForWeek(weekId: string) {
  const week = getWeekById(weekId);
  return submissions
    .filter((submission) => submission.weekId === weekId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((submission) => ({
      ...submission,
      player: players.find((player) => player.id === submission.playerId),
      week,
      game: week ? getGameById(week.gameId) : undefined,
    }));
}

export function getPlayerSubmissions(playerId: string, limit?: number) {
  const rows = submissions
    .filter((submission) => submission.playerId === playerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((submission) => ({
      ...submission,
      week: weeks.find((week) => week.id === submission.weekId),
      game: games.find(
        (game) => game.id === weeks.find((week) => week.id === submission.weekId)?.gameId,
      ),
    }));

  return typeof limit === "number" ? rows.slice(0, limit) : rows;
}

export function getPlayerWeekSummary(playerId: string, weekId = currentWeek.id) {
  const playerSubmissions = submissions.filter(
    (submission) =>
      submission.playerId === playerId &&
      submission.weekId === weekId &&
      submission.valid,
  );

  if (playerSubmissions.length === 0) {
    return null;
  }

  const sortedSubmissions = [...playerSubmissions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return {
    bestScore: Math.max(...playerSubmissions.map((submission) => submission.score)),
    uploads: playerSubmissions.length,
    lastSubmission: sortedSubmissions[0],
  };
}

export function getBestScoresByWeek(playerId: string) {
  return weeks
    .map((week) => {
      const playerSubmissions = submissions.filter(
        (submission) =>
          submission.playerId === playerId &&
          submission.weekId === week.id &&
          submission.valid,
      );

      if (playerSubmissions.length === 0) {
        return null;
      }

      const game = getGameById(week.gameId);

      return {
        week,
        game,
        bestScore: Math.max(...playerSubmissions.map((submission) => submission.score)),
        uploads: playerSubmissions.length,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function getWeekSummaries(): WeekSummary[] {
  return [...weeks]
    .filter((week) => getSeasonById(week.seasonId)?.status !== "draft")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((week) => {
      const leaderboard = getWeeklyLeaderboard(week.id);
      return {
        week,
        season: getSeasonById(week.seasonId) ?? currentSeason,
        game: getGameById(week.gameId) ?? games[0],
        winner: leaderboard[0]?.player,
        leaderboard,
      };
    });
}

export function getSeasonSummaries(): SeasonSummary[] {
  return [...seasons]
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((season) => ({
      season,
      champion: players.find((player) => player.id === season.championId),
      leader: players.find((player) => player.id === season.leaderId),
    }));
}

export function getSeasonWeeks(seasonId: string) {
  return getWeekSummaries()
    .filter((summary) => summary.week.seasonId === seasonId)
    .sort((a, b) => a.week.number - b.week.number);
}

export function getChatMessages(limit = 50): ChatMessageWithPlayer[] {
  return chatMessages
    .filter((message) => !message.isDeleted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit)
    .map((message) => ({
      ...message,
      player:
        players.find((player) => player.id === message.playerId) ?? players[0],
    }));
}
