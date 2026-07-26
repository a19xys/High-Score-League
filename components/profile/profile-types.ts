import type { RealProfile } from "@/types/supabase";

export type ProfileAuthData =
  | { status: "not-configured" }
  | { status: "signed-out" }
  | {
      status: "signed-in";
      email: string;
      profile: RealProfile | null;
      profileError: string | null;
      metadataUsername: string;
      metadataInitials: string;
    };

export type AdminCenterData = {
  isAdmin: boolean;
  currentWeekId?: string;
  currentWeekLabel?: string;
  activeWeekCount?: number;
  error?: string | null;
};
