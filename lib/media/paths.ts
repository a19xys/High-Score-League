import type { MediaPresetKey } from "./presets.ts";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PATH_PATTERNS: Record<MediaPresetKey, RegExp> = {
  avatar: new RegExp(`^avatars/(${UUID_PATTERN})/(${UUID_PATTERN})[.]webp$`, "i"),
  "benchmark-icon": new RegExp(`^benchmarks/icons/(${UUID_PATTERN})[.]webp$`),
  "game-header": new RegExp(`^games/headers/(${UUID_PATTERN})[.]webp$`, "i"),
  "game-logo": new RegExp(`^games/logos/(${UUID_PATTERN})[.]webp$`, "i"),
  "poll-option": new RegExp(`^polls/options/(${UUID_PATTERN})[.]webp$`, "i"),
};

export function createMediaStoragePath(
  preset: MediaPresetKey,
  options: { userId?: string; uuid?: () => string } = {},
) {
  const objectId = options.uuid ? options.uuid() : crypto.randomUUID();

  if (preset === "avatar") {
    if (!options.userId) {
      throw new Error("Falta el identificador del usuario para guardar el avatar.");
    }

    return `avatars/${options.userId}/${objectId}.webp`;
  }

  if (preset === "game-header") return `games/headers/${objectId}.webp`;
  if (preset === "game-logo") return `games/logos/${objectId}.webp`;
  if (preset === "poll-option") return `polls/options/${objectId}.webp`;
  return `benchmarks/icons/${objectId}.webp`;
}

export function isValidMediaStoragePath(
  value: unknown,
  preset: MediaPresetKey,
  userId?: string,
): value is string {
  if (typeof value !== "string") return false;
  const match = PATH_PATTERNS[preset].exec(value);
  if (!match) return false;
  return preset !== "avatar" || !userId || match[1].toLowerCase() === userId.toLowerCase();
}
