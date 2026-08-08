export const PROFILE_BIO_FALLBACK = "Sin descripción.";

export function getProfileBioDisplay(value?: string | null) {
  return value?.trim() || PROFILE_BIO_FALLBACK;
}
