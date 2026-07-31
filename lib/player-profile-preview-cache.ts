import type { PlayerProfilePreview } from "@/lib/data/player-profile-preview";

export const PLAYER_PROFILE_PREVIEW_TTL_MS = 45_000;

type PreviewReference = {
  playerId?: string | null;
  username: string;
};

type PreviewCacheEntry = {
  expiresAt: number;
  preview: PlayerProfilePreview;
};

type PendingPreviewRequest = {
  controller: AbortController;
  keys: string[];
  promise: Promise<PlayerProfilePreview>;
};

const previewCache = new Map<string, PreviewCacheEntry>();
const previewRequests = new Map<string, PendingPreviewRequest>();
let invalidationGeneration = 0;

function deleteCacheEntryAliases(entry: PreviewCacheEntry) {
  for (const [key, candidate] of previewCache) {
    if (candidate === entry) {
      previewCache.delete(key);
    }
  }
}

export class StalePlayerProfilePreviewRequestError extends Error {
  constructor() {
    super("player-profile-preview-request-stale");
    this.name = "StalePlayerProfilePreviewRequestError";
  }
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function getReferenceKeys(reference: PreviewReference) {
  return [
    reference.playerId ? `id:${reference.playerId}` : null,
    normalizeUsername(reference.username)
      ? `username:${normalizeUsername(reference.username)}`
      : null,
  ].filter((key): key is string => Boolean(key));
}

function getPreviewKeys(preview: PlayerProfilePreview) {
  return getReferenceKeys({
    playerId: preview.player.id,
    username: preview.player.username,
  });
}

export function getCachedPlayerProfilePreview(
  reference: PreviewReference,
  now = Date.now(),
) {
  for (const key of getReferenceKeys(reference)) {
    const entry = previewCache.get(key);

    if (!entry) {
      continue;
    }

    if (entry.expiresAt <= now) {
      deleteCacheEntryAliases(entry);
      continue;
    }

    return entry.preview;
  }

  return null;
}

export function requestCachedPlayerProfilePreview(
  reference: PreviewReference,
  loader: (signal: AbortSignal) => Promise<PlayerProfilePreview>,
  now: () => number = Date.now,
) {
  const cached = getCachedPlayerProfilePreview(reference, now());

  if (cached) {
    return Promise.resolve(cached);
  }

  const keys = getReferenceKeys(reference);

  for (const key of keys) {
    const pending = previewRequests.get(key);

    if (pending) {
      return pending.promise;
    }
  }

  const controller = new AbortController();
  const requestGeneration = invalidationGeneration;
  let pending: PendingPreviewRequest;
  const promise = loader(controller.signal)
    .then((preview) => {
      if (
        controller.signal.aborted ||
        requestGeneration !== invalidationGeneration
      ) {
        throw new StalePlayerProfilePreviewRequestError();
      }

      const entry = {
        expiresAt: now() + PLAYER_PROFILE_PREVIEW_TTL_MS,
        preview,
      };

      for (const key of new Set([...keys, ...getPreviewKeys(preview)])) {
        previewCache.set(key, entry);
      }

      return preview;
    })
    .finally(() => {
      for (const key of pending.keys) {
        if (previewRequests.get(key) === pending) {
          previewRequests.delete(key);
        }
      }
    });

  pending = { controller, keys, promise };
  keys.forEach((key) => previewRequests.set(key, pending));

  return promise;
}

export function invalidatePlayerProfilePreview({
  playerId,
  usernames = [],
}: {
  playerId?: string | null;
  usernames?: Array<string | null | undefined>;
}) {
  const keys = new Set([
    ...(playerId ? [`id:${playerId}`] : []),
    ...usernames
      .map((username) => normalizeUsername(username ?? ""))
      .filter(Boolean)
      .map((username) => `username:${username}`),
  ]);

  invalidationGeneration += 1;

  const entries = new Set(
    [...keys]
      .map((key) => previewCache.get(key))
      .filter((entry): entry is PreviewCacheEntry => Boolean(entry)),
  );
  const pendingRequests = new Set(
    [...keys]
      .map((key) => previewRequests.get(key))
      .filter((pending): pending is PendingPreviewRequest => Boolean(pending)),
  );

  for (const entry of entries) {
    deleteCacheEntryAliases(entry);
  }

  for (const pending of pendingRequests) {
    pending.controller.abort();
  }
}

export function resetPlayerProfilePreviewCache() {
  for (const pending of new Set(previewRequests.values())) {
    pending.controller.abort();
  }

  previewCache.clear();
  previewRequests.clear();
  invalidationGeneration = 0;
}
