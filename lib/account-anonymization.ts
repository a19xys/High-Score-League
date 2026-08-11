import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_MEDIA_BUCKET } from "@/lib/media/resolver";

const avatarFolderNamePattern = /^[0-9a-f-]{36}$/i;
const removableMetadataKeys = new Set([
  "avatar",
  "avatar_url",
  "avatarUrl",
  "avatar_storage_path",
  "bio",
  "initials",
  "is_admin",
  "play_time_public",
  "track_play_time",
  "username",
]);

type RpcRow = {
  anonymous_alias: string;
  already_anonymized: boolean;
  profile_anonymized_at: string;
  profile_id: string;
};

export type AccountAnonymizationStage = "database" | "storage" | "auth-metadata" | "auth";

export class AccountAnonymizationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly stage: AccountAnonymizationStage,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AccountAnonymizationError";
  }
}

function withoutProfileMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !removableMetadataKeys.has(key)),
  );
}

function isMissingAuthUser(error: { message?: string; status?: number } | null) {
  return Boolean(
    error &&
      (error.status === 404 || /user not found|not found/i.test(error.message ?? "")),
  );
}

async function listAvatarObjects(
  admin: SupabaseClient,
  folder: string,
  seenFolders: Set<string>,
): Promise<string[]> {
  if (seenFolders.has(folder)) {
    return [];
  }

  seenFolders.add(folder);
  const paths: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await admin.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .list(folder, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      throw new AccountAnonymizationError(
        "STORAGE_CLEANUP_FAILED",
        503,
        "storage",
        "No se pudieron retirar todas las imágenes personales. Inténtalo de nuevo.",
        true,
      );
    }

    const objects = data ?? [];

    for (const object of objects) {
      const path = `${folder}/${object.name}`;

      if (object.id) {
        paths.push(path);
      } else {
        paths.push(...(await listAvatarObjects(admin, path, seenFolders)));
      }
    }

    if (objects.length < 100) {
      break;
    }

    offset += objects.length;
  }

  return paths;
}

async function removeAvatarObjects(admin: SupabaseClient, userId: string) {
  if (!avatarFolderNamePattern.test(userId)) {
    throw new AccountAnonymizationError(
      "INVALID_ACCOUNT_ID",
      400,
      "storage",
      "No se pudo validar la cuenta.",
    );
  }

  const folder = `avatars/${userId}`;
  const paths = await listAvatarObjects(admin, folder, new Set());

  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .remove(paths.slice(index, index + 100));

    if (error && !/not found/i.test(error.message)) {
      throw new AccountAnonymizationError(
        "STORAGE_CLEANUP_FAILED",
        503,
        "storage",
        "No se pudieron retirar todas las imágenes personales. Inténtalo de nuevo.",
        true,
      );
    }
  }
}

async function cleanAuthMetadata(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);

  if (isMissingAuthUser(error)) {
    return;
  }

  if (error || !data.user) {
    throw new AccountAnonymizationError(
      "AUTH_METADATA_CLEANUP_FAILED",
      503,
      "auth-metadata",
      "La identidad ya está bloqueada, pero falta terminar la limpieza de acceso. Inténtalo de nuevo.",
      true,
    );
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: withoutProfileMetadata(data.user.app_metadata),
    user_metadata: withoutProfileMetadata(data.user.user_metadata),
  });

  if (updateError && !isMissingAuthUser(updateError)) {
    throw new AccountAnonymizationError(
      "AUTH_METADATA_CLEANUP_FAILED",
      503,
      "auth-metadata",
      "La identidad ya está bloqueada, pero falta terminar la limpieza de acceso. Inténtalo de nuevo.",
      true,
    );
  }
}

async function softDeleteAuthUser(admin: SupabaseClient, userId: string) {
  const { error } = await admin.auth.admin.deleteUser(userId, true);

  if (error && !isMissingAuthUser(error)) {
    throw new AccountAnonymizationError(
      "AUTH_SOFT_DELETE_FAILED",
      503,
      "auth",
      "La cuenta ya no tiene acceso a la liga, pero falta finalizar la baja. Inténtalo de nuevo.",
      true,
    );
  }
}

export async function anonymizeAccount({
  admin,
  userId,
}: {
  admin: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await admin.rpc("anonymize_profile_account", {
    p_profile_id: userId,
  });

  if (error) {
    if (/last_admin/i.test(error.message)) {
      throw new AccountAnonymizationError(
        "LAST_ADMIN",
        409,
        "database",
        "No puedes eliminar la única cuenta administradora de la liga.",
      );
    }

    throw new AccountAnonymizationError(
      "DATABASE_ANONYMIZATION_FAILED",
      500,
      "database",
      "No se pudo iniciar la anonimización. La cuenta no se ha modificado.",
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;

  if (!row?.profile_id || !row.anonymous_alias) {
    throw new AccountAnonymizationError(
      "DATABASE_ANONYMIZATION_FAILED",
      500,
      "database",
      "La anonimización no devolvió un resultado verificable.",
    );
  }

  await removeAvatarObjects(admin, userId);
  await cleanAuthMetadata(admin, userId);
  await softDeleteAuthUser(admin, userId);

  return {
    alreadyAnonymized: row.already_anonymized,
    anonymizedAt: row.profile_anonymized_at,
  };
}
