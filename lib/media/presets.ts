export type MediaPresetKey =
  | "avatar"
  | "game-header"
  | "game-logo"
  | "poll-option";

export type MediaPreset = {
  key: MediaPresetKey;
  label: string;
  maxWidth: number;
  maxHeight: number;
  initialQuality: number;
  minQuality: number;
  targetBytes: number;
  pathPrefix: string;
};

export const MAX_MEDIA_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_MEDIA_PIXELS = 25_000_000;
export const STORAGE_OBJECT_MAX_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MEDIA_PRESETS: Record<MediaPresetKey, MediaPreset> = {
  avatar: {
    key: "avatar",
    label: "Avatar",
    maxWidth: 512,
    maxHeight: 512,
    initialQuality: 0.86,
    minQuality: 0.54,
    targetBytes: 350 * 1024,
    pathPrefix: "avatars",
  },
  "game-header": {
    key: "game-header",
    label: "Cabecera del juego",
    maxWidth: 1920,
    maxHeight: 1080,
    initialQuality: 0.86,
    minQuality: 0.54,
    targetBytes: 1.5 * 1024 * 1024,
    pathPrefix: "games/headers",
  },
  "game-logo": {
    key: "game-logo",
    label: "Logo del juego",
    maxWidth: 1400,
    maxHeight: 1400,
    initialQuality: 0.92,
    minQuality: 0.6,
    targetBytes: 1024 * 1024,
    pathPrefix: "games/logos",
  },
  "poll-option": {
    key: "poll-option",
    label: "Imagen de opción",
    maxWidth: 1024,
    maxHeight: 1024,
    initialQuality: 0.85,
    minQuality: 0.53,
    targetBytes: 700 * 1024,
    pathPrefix: "polls/options",
  },
};

export function calculateResizeDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
