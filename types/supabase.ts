export type RealProfile = {
  id: string;
  username: string;
  initials: string;
  avatar_url: string | null;
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
  developer: string | null;
  publisher: string | null;
  rom_name: string | null;
  image_url: string | null;
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
