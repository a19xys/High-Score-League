export type RealProfile = {
  id: string;
  username: string;
  initials: string;
  avatar_url: string | null;
  is_admin: boolean;
  created_at?: string;
  updated_at?: string;
};
