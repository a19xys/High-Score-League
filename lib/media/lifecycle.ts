import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteManagedMedia, uploadProcessedMedia } from "./storage.ts";
import type { MediaSelection } from "./types.ts";

export type MediaSaveChange = {
  key: string;
  selection: MediaSelection;
  currentStoragePath?: string | null;
  currentUrl?: string | null;
  userId?: string;
};

export type PreparedMediaChange = {
  key: string;
  storagePath: string | null;
  publicUrl: string | null;
  uploadedPath: string | null;
  previousStoragePath: string | null;
};

export async function executeMediaSave<T>({
  supabase,
  changes,
  persist,
}: {
  supabase: SupabaseClient;
  changes: MediaSaveChange[];
  persist: (prepared: PreparedMediaChange[]) => Promise<T>;
}) {
  const prepared: PreparedMediaChange[] = [];
  const uploadedPaths: string[] = [];

  try {
    for (const change of changes) {
      if (change.selection.kind === "replace") {
        const upload = await uploadProcessedMedia(
          supabase,
          change.selection.media,
          change.userId,
        );
        uploadedPaths.push(upload.storagePath);
        prepared.push({
          key: change.key,
          storagePath: upload.storagePath,
          publicUrl: upload.publicUrl,
          uploadedPath: upload.storagePath,
          previousStoragePath: change.currentStoragePath ?? null,
        });
        continue;
      }

      prepared.push({
        key: change.key,
        storagePath:
          change.selection.kind === "remove" ? null : change.currentStoragePath ?? null,
        publicUrl: change.selection.kind === "remove" ? null : change.currentUrl ?? null,
        uploadedPath: null,
        previousStoragePath: change.currentStoragePath ?? null,
      });
    }

    const result = await persist(prepared);
    const oldPaths = prepared
      .filter((item) => {
        const source = changes.find((change) => change.key === item.key);
        return source?.selection.kind === "remove" || source?.selection.kind === "replace";
      })
      .map((item) => item.previousStoragePath)
      .filter((path) => path && !uploadedPaths.includes(path));
    const cleanupWarning = await deleteManagedMedia(supabase, oldPaths);
    return { result, cleanupWarning, prepared };
  } catch (error) {
    await deleteManagedMedia(supabase, uploadedPaths);
    throw error;
  }
}
