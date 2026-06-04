export type RealProfile = {
  id: string;
  username: string;
  initials: string;
  avatar_url: string | null;
  bio?: string | null;
  track_play_time?: boolean;
  is_admin: boolean;
  created_at?: string;
  updated_at?: string;
};

export type SeasonRow = {
  id: string;
  name: string;
  slug: string;
  version: string | null;
  status: "draft" | "active" | "completed";
  starts_at: string | null;
  ends_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export type GameRow = {
  id: string;
  title: string;
  year: number | null;
  developers: string[];
  publishers: string[];
  perspectives: string[];
  themes: string[];
  genres: string[];
  developer?: string | null;
  publisher?: string | null;
  rom_name: string | null;
  genre?: string | null;
  control_type?: string | null;
  difficulty?: string | null;
  image_url: string | null;
  instructions: string | null;
  manual_url: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WeekRow = {
  id: string;
  season_id: string;
  game_id: string;
  week_number: number;
  status: "draft" | "active" | "frozen" | "closed" | "published";
  public_start_at: string | null;
  public_freeze_at: string | null;
  final_deadline_at: string | null;
  reveal_at: string | null;
  rules_summary: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SubmissionSource =
  | "web"
  | "mame_memory"
  | "mame_plugin"
  | "local_app"
  | "admin_import";

export type SubmissionRow = {
  id: string;
  week_id: string;
  player_id: string;
  score: number;
  screenshot_path: string | null;
  screenshot_mime_type: string | null;
  screenshot_size_bytes: number | null;
  comment: string | null;
  is_hidden: boolean;
  is_valid: boolean;
  submitted_at: string;
  source: SubmissionSource;
  detected_at: string | null;
  rom_name: string | null;
  mame_version: string | null;
  client_version: string | null;
  duplicate_key: string | null;
  profiles?: RealProfile | RealProfile[] | null;
};

export type WeeklyResultRow = {
  id: string;
  week_id: string;
  player_id: string;
  final_score: number;
  rank: number;
  league_points: number;
  is_first_place: boolean;
  is_second_place: boolean;
  is_third_place: boolean;
  created_at: string;
  profiles?: RealProfile | RealProfile[] | null;
};

export type SeasonMembershipRow = {
  id: string;
  season_id: string;
  player_id: string;
  status: "active" | "left";
  joined_at: string;
  created_at: string;
};

export type WeekBenchmarkRow = {
  id: string;
  week_id: string;
  label: string;
  score: number;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LeagueChatMessageRow = {
  id: string;
  message_type: "user" | "system";
  author_id: string | null;
  content: string;
  created_at: string;
  profiles?: RealProfile | RealProfile[] | null;
};
