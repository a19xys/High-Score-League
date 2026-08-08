import type { MediaPresetKey } from "./presets.ts";

export type ProcessedMedia = {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  outputBytes: number;
  preset: MediaPresetKey;
};

export type MediaSelection =
  | { kind: "unchanged" }
  | { kind: "remove" }
  | { kind: "replace"; media: ProcessedMedia };

export const UNCHANGED_MEDIA_SELECTION: MediaSelection = { kind: "unchanged" };
