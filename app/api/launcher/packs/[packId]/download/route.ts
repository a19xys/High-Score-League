import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadLauncherPackCatalogRow,
  loadLauncherPackWeekVisibility,
  resolveLauncherPackDownload,
} from "@/lib/api/launcher-pack-download";
import { hasActiveProfile } from "@/lib/auth/active-profile";
import { createBearerAuthenticatedClient } from "@/lib/auth/request-client";
import { getLauncherDeploymentHeaders } from "@/lib/launcher-deployment";
import { createR2PackStorage } from "@/lib/pack-storage/r2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packId: string }> },
) {
  const { packId } = await context.params;
  const result = await resolveLauncherPackDownload(request, packId, {
    createBearerClient: createBearerAuthenticatedClient,
    createAdminClient: createSupabaseAdminClient,
    createStorage: createR2PackStorage,
    checkActiveProfile: (client, userId) => hasActiveProfile(client as SupabaseClient, userId),
    loadCatalogPack: loadLauncherPackCatalogRow,
    loadWeekVisibility: loadLauncherPackWeekVisibility,
    now: () => new Date(),
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...getLauncherDeploymentHeaders(),
    },
  });
}
