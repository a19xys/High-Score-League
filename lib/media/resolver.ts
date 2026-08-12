export const PUBLIC_MEDIA_BUCKET = "hsl-public-media";

export function getPublicMediaUrl(
  storagePath?: string | null,
  supabaseUrl?: string | null,
) {
  const baseUrl = supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl || !storagePath) return null;
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");

  try {
    return new URL(
      `/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/${encodedPath}`,
      baseUrl,
    ).toString();
  } catch {
    return null;
  }
}

export function resolveMediaUrl({
  storagePath,
  legacyUrl,
  supabaseUrl,
}: {
  storagePath?: string | null;
  legacyUrl?: string | null;
  supabaseUrl?: string | null;
}) {
  return (storagePath ? getPublicMediaUrl(storagePath, supabaseUrl) : null) ?? legacyUrl ?? null;
}
