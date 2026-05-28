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
  bio?: string;
  isAdmin: boolean;
};

export type Game = {
  id: string;
  title: string;
  slug: string;
  developer: string;
  genre: string;
  controlType: string;
  difficulty: string;
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
  screenshotUrl?: string | null;
  screenshotMimeType?: string | null;
  screenshotSizeBytes?: number | null;
  comment?: string;
  createdAt: string;
  valid: boolean;
  hidden?: boolean;
  source?: "web" | "mame_memory" | "mame_plugin" | "local_app" | "admin_import";
  detectedAt?: string | null;
  romName?: string | null;
  mameVersion?: string | null;
  clientVersion?: string | null;
  duplicateKey?: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  player: Player;
  bestScore: number;
  uploads: number;
  lastSubmissionAt: string;
  gapToFirst: number;
};

export type WeekBenchmark = {
  id: string;
  weekId: string;
  label: string;
  score: number;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
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
  isTied?: boolean;
};

export type WeeklyResult = {
  id: string;
  weekId: string;
  playerId: string;
  finalScore: number;
  rank: number;
  leaguePoints: number;
  isFirstPlace: boolean;
  isSecondPlace: boolean;
  isThirdPlace: boolean;
  createdAt: string;
  player?: Player;
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
  membershipStatus?: "joined" | "not_joined" | "login_required" | "closed";
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

export type LeagueChatMessage = {
  id: string;
  messageType: "user" | "system";
  authorId?: string | null;
  content: string;
  createdAt: string;
  author?: Player | null;
};
