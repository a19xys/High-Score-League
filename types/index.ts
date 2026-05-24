export type WeekStatus = "draft" | "active" | "frozen" | "closed" | "published";
export type SeasonStatus = "draft" | "active" | "completed";

// Profile values are validated by the app and Supabase checks:
// username: ^[a-z][a-z0-9_]{2,19}$
// initials: ^[A-Z0-9]{3}$
export type Username = string;
export type PlayerInitials = string;

export type Player = {
  id: string;
  username: Username;
  initials: PlayerInitials;
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
  slug: string;
  version?: string;
  status: SeasonStatus;
  startsAt: string;
  endsAt: string;
  weekCount: number;
  championId?: string;
  leaderId?: string;
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
  hidden?: boolean;
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
  positionChange: number;
  firstPlaces: number;
  secondPlaces: number;
  thirdPlaces: number;
  weeksPlayed: number;
};

export type WeekSummary = {
  week: Week;
  season: Season;
  game: Game;
  winner?: Player;
  leaderboard: LeaderboardEntry[];
};

export type SeasonSummary = {
  season: Season;
  leader?: Player;
  champion?: Player;
};

export type ChatMessage = {
  id: string;
  playerId: string;
  body: string;
  createdAt: string;
  isDeleted?: boolean;
};

export type ChatMessageWithPlayer = ChatMessage & {
  player: Player;
};
