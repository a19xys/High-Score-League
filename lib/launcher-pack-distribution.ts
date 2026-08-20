import type { LauncherPackRow } from "../types/supabase.ts";

export const LAUNCHER_PACK_DESCRIPTOR_VERSION = 1;
export const LAUNCHER_PACK_MAX_SIZE_BYTES = 1024 * 1024 * 1024;
export const LAUNCHER_PACK_PRESIGN_TTL_SECONDS = 15 * 60;

const packIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const databaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type LauncherPackDescriptor = {
  version: 1;
  packId: string;
  artifact: {
    sizeBytes: number;
    sha256: string;
    downloadUrl: string;
  };
};

export type ValidatedLauncherPack = Pick<
  LauncherPackRow,
  "pack_id" | "week_id" | "size_bytes" | "sha256" | "object_key" | "status" | "published_at"
>;

export function isLauncherPackId(value: unknown): value is string {
  return typeof value === "string" && packIdPattern.test(value);
}

export function isLauncherPackDatabaseWeekId(value: unknown): value is string {
  return typeof value === "string" && databaseUuidPattern.test(value);
}

export function deriveLauncherPackObjectKey(packId: string, sha256: string) {
  return `packs/v1/${packId}/${sha256}.hslpack.zip`;
}

export function validateLauncherPackCatalogRow(
  value: unknown,
  requestedPackId: string,
): ValidatedLauncherPack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sizeBytes = Number(row.size_bytes);

  if (
    row.pack_id !== requestedPackId ||
    !isLauncherPackId(row.pack_id) ||
    !isLauncherPackDatabaseWeekId(row.week_id) ||
    row.status !== "published" ||
    typeof row.published_at !== "string" ||
    !row.published_at ||
    Number.isNaN(new Date(row.published_at).getTime()) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > LAUNCHER_PACK_MAX_SIZE_BYTES ||
    typeof row.sha256 !== "string" ||
    !sha256Pattern.test(row.sha256) ||
    row.object_key !== deriveLauncherPackObjectKey(row.pack_id, row.sha256)
  ) {
    return null;
  }

  return {
    pack_id: row.pack_id,
    week_id: row.week_id,
    size_bytes: sizeBytes,
    sha256: row.sha256,
    object_key: row.object_key,
    status: "published",
    published_at: row.published_at,
  };
}

export function isSafeLauncherPackDownloadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !hostname.startsWith("127.") &&
      hostname !== "0.0.0.0" &&
      hostname !== "::1" &&
      hostname !== "[::1]";
  } catch {
    return false;
  }
}

export function buildLauncherPackDescriptor(options: {
  pack: ValidatedLauncherPack;
  downloadUrl: string;
}): LauncherPackDescriptor | null {
  if (!isSafeLauncherPackDownloadUrl(options.downloadUrl)) return null;

  return {
    version: LAUNCHER_PACK_DESCRIPTOR_VERSION,
    packId: options.pack.pack_id,
    artifact: {
      sizeBytes: options.pack.size_bytes,
      sha256: options.pack.sha256,
      downloadUrl: options.downloadUrl,
    },
  };
}
