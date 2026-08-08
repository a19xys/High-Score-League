import type { SupabaseClient } from "@supabase/supabase-js";
import { createMediaStoragePath } from "./paths.ts";
import { PUBLIC_MEDIA_BUCKET, getPublicMediaUrl } from "./resolver.ts";
import type { ProcessedMedia } from "./types.ts";

export async function uploadProcessedMedia(
  supabase: SupabaseClient,
  media: ProcessedMedia,
  userId?: string,
) {
  const storagePath = createMediaStoragePath(media.preset, { userId });
  const publicUrl = getPublicMediaUrl(storagePath);
  if (!publicUrl) throw new Error("No se pudo resolver la URL pública de la imagen.");
  const { error } = await supabase.storage.from(PUBLIC_MEDIA_BUCKET).upload(
    storagePath,
    media.blob,
    {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: false,
    },
  );

  if (error) {
    await supabase.storage.from(PUBLIC_MEDIA_BUCKET).remove([storagePath]);
    throw new Error(`No se pudo subir la imagen: ${error.message}`);
  }
  return { storagePath, publicUrl };
}

export async function deleteManagedMedia(
  supabase: SupabaseClient,
  paths: Array<string | null | undefined>,
) {
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (uniquePaths.length === 0) return null;
  const { error } = await supabase.storage.from(PUBLIC_MEDIA_BUCKET).remove(uniquePaths);
  return error?.message ?? null;
}
