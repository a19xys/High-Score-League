import { isLauncherPackId } from "./launcher-pack-distribution.ts";

export const LAUNCHER_PACK_AVAILABILITY_WARNING =
  "No se pudo comprobar la disponibilidad del pack.";

type CatalogQueryResult = {
  data: unknown;
  error: unknown;
};

type CatalogQuery = {
  eq(column: string, value: unknown): CatalogQuery;
  maybeSingle(): Promise<CatalogQueryResult>;
};

export type LauncherPackCatalogClient = {
  from(table: string): {
    select(columns: string): CatalogQuery;
  };
};

export type WeekLauncherPackResult = {
  launcherPackId: string | null;
  warning: string | null;
};

const unavailableResult = (): WeekLauncherPackResult => ({
  launcherPackId: null,
  warning: null,
});

const failedResult = (): WeekLauncherPackResult => ({
  launcherPackId: null,
  warning: LAUNCHER_PACK_AVAILABILITY_WARNING,
});

export async function resolveWeekLauncherPack(options: {
  createAdminClient: () => LauncherPackCatalogClient | null;
  isSecret: boolean;
  weekId: string;
}): Promise<WeekLauncherPackResult> {
  if (options.isSecret) return unavailableResult();

  try {
    const admin = options.createAdminClient();
    if (!admin) return failedResult();

    const { data, error } = await admin
      .from("launcher_packs")
      .select("pack_id")
      .eq("week_id", options.weekId)
      .eq("status", "published")
      .maybeSingle();

    if (error) return failedResult();
    if (data === null) return unavailableResult();
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !isLauncherPackId((data as { pack_id?: unknown }).pack_id)
    ) {
      return failedResult();
    }

    return {
      launcherPackId: (data as { pack_id: string }).pack_id,
      warning: null,
    };
  } catch {
    return failedResult();
  }
}
