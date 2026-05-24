export type WeekStatus = "active" | "frozen" | "closed" | "published";

export type Player = {
  id: string;
  name: string;
  initials: string;
  handle: string;
};

export type Game = {
  id: string;
  title: string;
  slug: string;
  genre: string;
  imageAlt: string;
};

export type Season = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  weekCount: number;
};

export type Week = {
  id: string;
  seasonId: string;
  gameId: string;
  number: number;
  startsAt: string;
  endsAt: string;
  status: WeekStatus;
  rules: string[];
};

export type Submission = {
  id: string;
  weekId: string;
  playerId: string;
  score: number;
  screenshotUrl: string;
  comment?: string;
  createdAt: string;
  valid: boolean;
};

export type LeaderboardEntry = {
  rank: number;
  player: Player;
  bestScore: number;
  uploads: number;
  lastSubmissionAt: string;
  gapToFirst: number;
};

export type SeasonStanding = {
  rank: number;
  player: Player;
  totalPoints: number;
  firstPlaces: number;
  secondPlaces: number;
  weeksPlayed: number;
};
