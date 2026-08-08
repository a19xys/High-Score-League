import test from "node:test";
import assert from "node:assert/strict";
import { executeMediaSave } from "../lib/media/lifecycle.ts";
import { createMediaStoragePath, isValidMediaStoragePath } from "../lib/media/paths.ts";
import {
  MAX_MEDIA_INPUT_BYTES,
  MEDIA_PRESETS,
  calculateResizeDimensions,
} from "../lib/media/presets.ts";
import {
  validateDecodedDimensions,
  validateMediaInput,
} from "../lib/media/process-image.ts";
import { getPublicMediaUrl, resolveMediaUrl } from "../lib/media/resolver.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";

test("media paths follow the four entity contracts", () => {
  assert.equal(
    createMediaStoragePath("avatar", { userId, uuid: () => objectId }),
    `avatars/${userId}/${objectId}.webp`,
  );
  assert.equal(
    createMediaStoragePath("game-header", { uuid: () => objectId }),
    `games/headers/${objectId}.webp`,
  );
  assert.equal(
    createMediaStoragePath("game-logo", { uuid: () => objectId }),
    `games/logos/${objectId}.webp`,
  );
  assert.equal(
    createMediaStoragePath("poll-option", { uuid: () => objectId }),
    `polls/options/${objectId}.webp`,
  );
  assert.equal(
    isValidMediaStoragePath(`avatars/${userId}/${objectId}.webp`, "avatar", userId),
    true,
  );
  assert.equal(isValidMediaStoragePath("games/headers/not-a-uuid.webp", "game-header"), false);
  assert.equal(isValidMediaStoragePath(`polls/options/${objectId}.png`, "poll-option"), false);
});

test("presets bound dimensions without upscaling", () => {
  assert.deepEqual(calculateResizeDimensions(4000, 2000, 1920, 1080), {
    width: 1920,
    height: 960,
  });
  assert.deepEqual(calculateResizeDimensions(320, 200, 512, 512), {
    width: 320,
    height: 200,
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(MEDIA_PRESETS).map(([key, value]) => [
        key,
        [value.maxWidth, value.maxHeight, value.targetBytes],
      ]),
    ),
    {
      avatar: [512, 512, 350 * 1024],
      "game-header": [1920, 1080, 1.5 * 1024 * 1024],
      "game-logo": [1400, 1400, 1024 * 1024],
      "poll-option": [1024, 1024, 700 * 1024],
    },
  );
});

test("input validation enforces MIME, bytes and decoded pixels", () => {
  assert.equal(validateMediaInput({ type: "image/jpeg", size: 123 }), null);
  assert.equal(validateMediaInput({ type: "image/svg+xml", size: 123 }), "Formato no admitido. Usa JPEG, PNG o WebP.");
  assert.equal(
    validateMediaInput({ type: "image/png", size: MAX_MEDIA_INPUT_BYTES + 1 }),
    "La imagen original no puede superar 12 MB.",
  );
  assert.equal(validateDecodedDimensions(5000, 5000), null);
  assert.equal(validateDecodedDimensions(5001, 5000), "La imagen no puede superar 25 megapíxeles.");
});

test("public resolver prefers managed Storage and keeps legacy fallback", () => {
  const managed = getPublicMediaUrl(
    `games/logos/${objectId}.webp`,
    "https://project.supabase.co",
  );
  assert.equal(
    managed,
    `https://project.supabase.co/storage/v1/object/public/hsl-public-media/games/logos/${objectId}.webp`,
  );
  assert.equal(
    resolveMediaUrl({
      storagePath: `games/logos/${objectId}.webp`,
      legacyUrl: "https://legacy.example/logo.png",
      supabaseUrl: "https://project.supabase.co",
    }),
    managed,
  );
  assert.equal(
    resolveMediaUrl({ legacyUrl: "https://legacy.example/logo.png" }),
    "https://legacy.example/logo.png",
  );
});

function fakeSupabase() {
  const uploaded: string[] = [];
  const removed: string[][] = [];
  const client = {
    storage: {
      from() {
        return {
          async upload(path: string) {
            uploaded.push(path);
            return { error: null };
          },
          async remove(paths: string[]) {
            removed.push(paths);
            return { error: null };
          },
        };
      },
    },
  };
  return { client, uploaded, removed };
}

test("lifecycle persists before deleting the replaced managed object", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  const storage = fakeSupabase();
  const events: string[] = [];
  const result = await executeMediaSave({
    supabase: storage.client as never,
    changes: [
      {
        key: "logo",
        selection: {
          kind: "replace",
          media: {
            blob: new Blob(["webp"], { type: "image/webp" }),
            width: 10,
            height: 10,
            originalBytes: 10,
            outputBytes: 4,
            preset: "game-logo",
          },
        },
        currentStoragePath: `games/logos/${objectId}.webp`,
      },
    ],
    persist: async ([prepared]) => {
      events.push("persist");
      assert.equal(prepared.storagePath, storage.uploaded[0]);
      assert.equal(storage.removed.length, 0);
      return "saved";
    },
  });
  events.push("cleanup");
  assert.equal(result.result, "saved");
  assert.deepEqual(events, ["persist", "cleanup"]);
  assert.deepEqual(storage.removed, [[`games/logos/${objectId}.webp`]]);
});

test("lifecycle rolls back every new object when persistence fails", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  const storage = fakeSupabase();
  await assert.rejects(
    executeMediaSave({
      supabase: storage.client as never,
      changes: [
        {
          key: "poll",
          selection: {
            kind: "replace",
            media: {
              blob: new Blob(["webp"], { type: "image/webp" }),
              width: 10,
              height: 10,
              originalBytes: 10,
              outputBytes: 4,
              preset: "poll-option",
            },
          },
        },
      ],
      persist: async () => {
        throw new Error("database rejected");
      },
    }),
    /database rejected/,
  );
  assert.equal(storage.uploaded.length, 1);
  assert.deepEqual(storage.removed, [[storage.uploaded[0]]]);
});
