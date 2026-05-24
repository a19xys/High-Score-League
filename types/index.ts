export type WeekStatus = "draft" | "active" | "frozen" | "closed" | "published";

export type Player = {
  id: string;
  username: string;
  initials: string;
  avatarUrl?: string;
  isAdmin: boolean;
};

export type Game = {
  id: string;
  title: string;
  slug: string;
  genre: string;
  imageAlt: string;
  imageUrl?: string;
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
  revealAt?: string;
  manualUrl?: string;
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
  podiumGaps: Array<{
    rank: 1 | 2 | 3;
    gap: number;
  }>;
};

export type SeasonStanding = {
  rank: number;
  player: Player;
  totalPoints: number;
  firstPlaces: number;
  secondPlaces: number;
  weeksPlayed: number;
};
