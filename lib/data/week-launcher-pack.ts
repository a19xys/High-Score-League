import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  resolveWeekLauncherPack,
  type LauncherPackCatalogClient,
} from "@/lib/launcher-week-pack";

export function getWeekLauncherPack(isSecret: boolean, weekId: string) {
  return resolveWeekLauncherPack({
    createAdminClient: () =>
      createSupabaseAdminClient() as LauncherPackCatalogClient | null,
    isSecret,
    weekId,
  });
}
