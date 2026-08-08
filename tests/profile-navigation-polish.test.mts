import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PROFILE_BIO_MAX_LENGTH,
  validateProfileBio,
} from "../lib/auth/validation.ts";
import { createBreadcrumbTrail } from "../lib/breadcrumbs.ts";
import { formatFullDate } from "../lib/format.ts";
import {
  getCachedPlayerProfilePreview,
  invalidatePlayerProfilePreview,
  PLAYER_PROFILE_PREVIEW_TTL_MS,
  requestCachedPlayerProfilePreview,
  resetPlayerProfilePreviewCache,
  StalePlayerProfilePreviewRequestError,
} from "../lib/player-profile-preview-cache.ts";
import { getProfileBioDisplay, PROFILE_BIO_FALLBACK } from "../lib/profile.ts";

function makePreview(id: string, username: string, bio = "Bio") {
  return {
    isCurrentUser: false,
    player: {
      id,
      username,
      initials: "ABC",
      avatarUrl: null,
      bio,
    },
    stats: { victories: 1, podiums: 2, officialResults: 3 },
  };
}

test("profile bio validation shares the 150 character contract", () => {
  assert.equal(PROFILE_BIO_MAX_LENGTH, 150);
  assert.equal(validateProfileBio(""), null);
  assert.equal(validateProfileBio("x".repeat(149)), null);
  assert.equal(validateProfileBio("x".repeat(150)), null);
  assert.equal(validateProfileBio(`  ${"x".repeat(150)}  `), null);
  assert.equal(
    validateProfileBio("x".repeat(151)),
    "La bio no puede superar los 150 caracteres.",
  );
  assert.equal(PROFILE_BIO_FALLBACK, "Sin descripción.");
  assert.equal(getProfileBioDisplay(null), "Sin descripción.");
  assert.equal(getProfileBioDisplay("   "), "Sin descripción.");
});

test("full profile date uses the Madrid competition date", () => {
  assert.equal(formatFullDate("2026-05-24T22:30:00.000Z"), "25 de mayo de 2026");
});

test("breadcrumbs always start at Liga and mark the final item as current", () => {
  assert.deepEqual(
    createBreadcrumbTrail([
      { href: "/archive", label: "Archivo" },
      { href: "/archive/seasons", label: "Temporadas" },
      { href: "/seasons/test", label: "Temporada Test" },
      { href: "/weeks/week-1", label: "Pac-Man" },
    ]),
    [
      { href: "/", label: "Liga" },
      { href: "/archive", label: "Archivo" },
      { href: "/archive/seasons", label: "Temporadas" },
      { href: "/seasons/test", label: "Temporada Test" },
      { label: "Pac-Man" },
    ],
  );
});

test("navigation loads the canonical brand asset in the browser", async () => {
  const root = process.cwd();
  const [serverNav, clientNav, brandImage, homePage] = await Promise.all([
    readFile(join(root, "components", "site-nav.tsx"), "utf8"),
    readFile(join(root, "components", "site-nav-client.tsx"), "utf8"),
    readFile(join(root, "components", "brand-image.tsx"), "utf8"),
    readFile(join(root, "app", "page.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(serverNav, /hasBrandLogo|existsSync|node:fs|node:path/);
  assert.doesNotMatch(clientNav, /hasBrandLogo/);
  assert.match(clientNav, /href: "\/archive"/);
  assert.match(brandImage, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(brandImage, /\[src\]/);
  assert.doesNotMatch(homePage, /existsSync|node:fs|node:path/);
});

test("preview cache reuses fresh values and expires after its TTL", async () => {
  resetPlayerProfilePreviewCache();
  let now = 1_000;
  let loads = 0;
  const preview = makePreview("player-1", "alice");
  const loaded = await requestCachedPlayerProfilePreview(
    { playerId: "player-1", username: "alice" },
    async () => {
      loads += 1;
      return preview;
    },
    () => now,
  );

  assert.equal(loaded, preview);
  assert.equal(loads, 1);
  assert.equal(
    getCachedPlayerProfilePreview({ playerId: "player-1", username: "alice" }, now),
    preview,
  );
  now += PLAYER_PROFILE_PREVIEW_TTL_MS;
  assert.equal(
    getCachedPlayerProfilePreview({ playerId: "player-1", username: "alice" }, now),
    null,
  );
});

test("preview cache deduplicates simultaneous requests", async () => {
  resetPlayerProfilePreviewCache();
  let resolvePreview!: (preview: ReturnType<typeof makePreview>) => void;
  let loads = 0;
  const loader = () => {
    loads += 1;
    return new Promise<ReturnType<typeof makePreview>>((resolve) => {
      resolvePreview = resolve;
    });
  };
  const first = requestCachedPlayerProfilePreview(
    { playerId: "player-2", username: "bob" },
    loader,
  );
  const second = requestCachedPlayerProfilePreview(
    { playerId: "player-2", username: "bob" },
    loader,
  );

  assert.equal(first, second);
  assert.equal(loads, 1);
  resolvePreview(makePreview("player-2", "bob"));
  await first;
});

test("preview cache invalidates ID and username aliases", async () => {
  resetPlayerProfilePreviewCache();
  await requestCachedPlayerProfilePreview(
    { playerId: "player-3", username: "carol" },
    async () => makePreview("player-3", "carol"),
  );
  invalidatePlayerProfilePreview({ playerId: "player-3" });
  assert.equal(
    getCachedPlayerProfilePreview({ playerId: "player-3", username: "carol" }),
    null,
  );

  await requestCachedPlayerProfilePreview(
    { username: "dave" },
    async () => makePreview("player-4", "dave"),
  );
  invalidatePlayerProfilePreview({ usernames: ["dave"] });
  assert.equal(getCachedPlayerProfilePreview({ username: "dave" }), null);
});

test("an invalidated old request cannot repopulate a renamed profile", async () => {
  resetPlayerProfilePreviewCache();
  let resolveOld!: (preview: ReturnType<typeof makePreview>) => void;
  const oldRequest = requestCachedPlayerProfilePreview(
    { playerId: "player-5", username: "old_name" },
    () =>
      new Promise<ReturnType<typeof makePreview>>((resolve) => {
        resolveOld = resolve;
      }),
  );

  invalidatePlayerProfilePreview({
    playerId: "player-5",
    usernames: ["old_name", "new_name"],
  });
  resolveOld(makePreview("player-5", "old_name", "Bio antigua"));
  await assert.rejects(oldRequest, StalePlayerProfilePreviewRequestError);
  assert.equal(
    getCachedPlayerProfilePreview({ playerId: "player-5", username: "old_name" }),
    null,
  );

  const fresh = await requestCachedPlayerProfilePreview(
    { playerId: "player-5", username: "new_name" },
    async () => makePreview("player-5", "new_name", "Bio nueva"),
  );
  assert.equal(fresh.player.username, "new_name");
  assert.equal(fresh.player.bio, "Bio nueva");
});
