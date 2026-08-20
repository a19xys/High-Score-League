import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPlayerBestScores } from "../lib/profile-best-scores.ts";
import {
  ALL_PROFILE_GAMES,
  filterProfileSubmissionsByGame,
  getDefaultProfileSubmissionGame,
  getProfileSubmissionGameOptions,
} from "../lib/profile-submission-games.ts";
import { resolveProfileSection } from "../lib/profile-sections.ts";
import { getProfileAvatarPresentation } from "../lib/profile-avatar-presentation.ts";

const read = (...parts: string[]) => readFile(join(process.cwd(), ...parts), "utf8");

const week = (id: string, gameId: string, seasonId = "season-1") => ({
  id,
  seasonId,
  gameId,
  number: Number(id.replace(/\D/g, "")) || 1,
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2026-01-08T00:00:00Z",
  status: "published" as const,
  rules: [],
});

test("submission game options are unique, recent-first and default to latest activity", () => {
  const submissions = [
    {
      id: "s-old",
      weekId: "week-1",
      playerId: "p1",
      score: 10,
      createdAt: "2026-01-01T10:00:00Z",
      valid: true,
      week: week("week-1", "game-1"),
      game: { id: "game-1", title: "Pac-Man" },
    },
    {
      id: "s-new",
      weekId: "week-2",
      playerId: "p1",
      score: 20,
      createdAt: "2026-02-01T10:00:00Z",
      valid: true,
      week: week("week-2", "game-2"),
      game: { id: "game-2", title: "Donkey Kong" },
    },
    {
      id: "s-newer-same-game",
      weekId: "week-3",
      playerId: "p1",
      score: 30,
      createdAt: "2026-03-01T10:00:00Z",
      valid: true,
      week: week("week-3", "game-1"),
      game: { id: "game-1", title: "Pac-Man" },
    },
  ] as Parameters<typeof getProfileSubmissionGameOptions>[0];

  assert.deepEqual(
    getProfileSubmissionGameOptions(submissions).map((option) => option.id),
    ["game-1", "game-2"],
  );
  assert.equal(getDefaultProfileSubmissionGame(submissions), "game-1");
  assert.deepEqual(
    filterProfileSubmissionsByGame(submissions, "game-2").map((row) => row.id),
    ["s-new"],
  );
  assert.equal(filterProfileSubmissionsByGame(submissions, ALL_PROFILE_GAMES).length, 3);
  assert.equal(getDefaultProfileSubmissionGame([]), ALL_PROFILE_GAMES);
  assert.deepEqual(getProfileSubmissionGameOptions([]), []);
});

test("best scores keep the weekly maximum and attach official rank without N+1", () => {
  const weeksById = new Map([
    ["week-1", week("week-1", "game-1")],
    ["week-2", week("week-2", "game-2")],
  ]);
  const gamesById = new Map([
    ["game-1", { id: "game-1", title: "Pac-Man" }],
    ["game-2", { id: "game-2", title: "Donkey Kong" }],
  ]) as Parameters<typeof buildPlayerBestScores>[0]["gamesById"];
  const rows = [
    { week_id: "week-1", score: 100, submitted_at: "2026-01-01T00:00:00Z" },
    { week_id: "week-1", score: 250, submitted_at: "2026-01-02T00:00:00Z" },
    { week_id: "week-2", score: 80, submitted_at: "2026-02-01T00:00:00Z" },
  ] as Parameters<typeof buildPlayerBestScores>[0]["rows"];

  const scores = buildPlayerBestScores({
    rows,
    weeksById,
    gamesById,
    rankByWeekId: new Map([["week-1", 2]]),
    seasonNamesById: new Map([["season-1", "Temporada I"]]),
  });

  assert.equal(scores[0].week.id, "week-2");
  assert.equal(scores[0].rank, null);
  assert.equal(scores[1].bestScore, 250);
  assert.equal(scores[1].rank, 2);
  assert.equal(scores[1].uploads, 2);
  assert.equal(scores[1].seasonName, "Temporada I");
});

test("profile section hashes resolve defaults, legacy aliases and admin availability", () => {
  const memberSections = ["resumen", "envios", "editar", "cuenta"] as const;
  const adminSections = [...memberSections, "administracion"] as const;

  assert.equal(resolveProfileSection("", memberSections), "resumen");
  assert.equal(resolveProfileSection("#envios", memberSections), "envios");
  assert.equal(resolveProfileSection("#trayectoria", memberSections), "resumen");
  assert.equal(resolveProfileSection("#editar-perfil", memberSections), "editar");
  assert.equal(resolveProfileSection("#centro-admin", adminSections), "administracion");
  assert.equal(resolveProfileSection("#administracion", memberSections), "resumen");
  assert.equal(resolveProfileSection("#desconocido", memberSections), "resumen");
  assert.equal(resolveProfileSection("#%E0%A4%A", memberSections), "resumen");
});

test("submissions use fixed columns, container queries and one row-height contract", async () => {
  const [table, styles] = await Promise.all([
    read("components", "submissions-table.tsx"),
    read("app", "globals.css"),
  ]);

  assert.match(table, /function getSubmissionRowContract/);
  assert.match(table, /const \{ cellClassName, rowClassName \} = getSubmissionRowContract\(showWeek\)/);
  assert.match(table, /<colgroup>/);
  assert.match(table, /table-fixed/);
  assert.match(table, /<tr aria-hidden="true" className=\{rowClassName\}>/);
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /@container submissions-table/);
  assert.match(styles, /table-layout:\s*fixed/);
  assert.doesNotMatch(table, /ResizeObserver|window\.innerWidth|getBoundingClientRect/);
});

test("the profile workspace is accessible, mounted and free of the old anchor navigation", async () => {
  const [dashboard, switcher, hero, stats, liveStats, historyExists] = await Promise.all([
    read("components", "profile-dashboard.tsx"),
    read("components", "profile", "profile-section-switcher.tsx"),
    read("components", "profile", "profile-hero.tsx"),
    read("components", "profile", "profile-stats.tsx"),
    read("components", "profile", "profile-live-stats.tsx"),
    read("components", "profile", "profile-history.tsx").then(
      () => true,
      () => false,
    ),
  ]);

  assert.match(switcher, /role="tablist"/);
  assert.match(switcher, /role="tab"/);
  assert.match(switcher, /role="tabpanel"/);
  assert.match(switcher, /ArrowLeft|ArrowRight/);
  assert.match(switcher, /Home/);
  assert.match(switcher, /End/);
  assert.match(switcher, /hidden=\{section\.id !== activeSection\}/);
  assert.match(dashboard, /id: "resumen"[\s\S]*id: "envios"[\s\S]*id: "editar"[\s\S]*id: "cuenta"/);
  assert.doesNotMatch(hero, /Editar identidad|Ver perfil público/);
  assert.doesNotMatch(stats, /label: "Resultados"/);
  assert.match(stats, /lg:grid-cols-4/);
  assert.match(stats, />\s*Victorias\s*</);
  assert.match(stats, /stats\.podiums === 1 \? "podio" : "podios"/);
  assert.match(stats, />\s*Medallas\s*</);
  assert.match(stats, />\s*—\s*</);
  assert.doesNotMatch(stats, /stats\.participations|>\s*Participaciones\s*</);
  assert.match(stats, /ProfileLiveStats/);
  assert.match(liveStats, /PlayerPresenceIndicator/);
  assert.doesNotMatch(liveStats, /col-span-2|lg:col-span-1/);
  assert.equal(historyExists, false);
});

test("avatar image and initials are mutually exclusive across valid, absent and failed states", async () => {
  const avatar = await read("components", "profile", "profile-avatar.tsx");

  assert.deepEqual(getProfileAvatarPresentation("/avatar.png", null), {
    showImage: true,
    showInitials: false,
  });
  assert.deepEqual(getProfileAvatarPresentation(null, null), {
    showImage: false,
    showInitials: true,
  });
  assert.deepEqual(getProfileAvatarPresentation("/avatar.png", "/avatar.png"), {
    showImage: false,
    showInitials: true,
  });
  assert.deepEqual(getProfileAvatarPresentation("/new-avatar.png", "/old-avatar.png"), {
    showImage: true,
    showInitials: false,
  });
  assert.match(avatar, /showInitials \? initials \|\| "HSL" : null/);
  assert.match(avatar, /showImage \? \([\s\S]*<img/);
  assert.match(avatar, /onError=\{\(\) => setFailedAvatarUrl\(avatarUrl \?\? null\)\}/);
  assert.match(avatar, /role=\{decorative \? undefined : "img"\}/);
  assert.match(avatar, /aria-hidden=\{decorative \? "true" : undefined\}/);
  assert.match(avatar, /alt=""/);
});

test("avatar ring and public logo separate transform motion from visual shadow", async () => {
  const [styles, hero, landing] = await Promise.all([
    read("app", "globals.css"),
    read("components", "profile", "profile-hero.tsx"),
    read("components", "public-landing.tsx"),
  ]);

  assert.match(hero, /glow/);
  assert.match(styles, /profile-avatar-glow::before/);
  assert.match(styles, /conic-gradient/);
  assert.match(styles, /profile-avatar-ring-spin 5\.5s linear infinite/);
  const motionRule = styles.match(/\.public-landing-logo-motion\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const imageRule = styles.match(/\.public-landing-logo-image\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const fallbackRule = styles.match(/\.public-landing-logo-fallback\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(motionRule, /animation:\s*public-landing-logo-breathe 6\.2s ease-in-out infinite/);
  assert.match(motionRule, /transform-origin:\s*center/);
  assert.match(motionRule, /will-change:\s*transform/);
  assert.doesNotMatch(motionRule, /filter|drop-shadow/);
  assert.match(imageRule, /filter:\s*drop-shadow\(var\(--landing-logo-shadow\)\)/);
  assert.match(fallbackRule, /filter:\s*drop-shadow\(var\(--landing-logo-shadow\)\)/);
  assert.match(styles, /max-inline-size:\s*calc\(100% \/ 1\.09\)/);
  assert.match(styles, /@keyframes public-landing-logo-breathe[\s\S]*50%\s*\{\s*transform: scale\(1\.09\)/);
  assert.doesNotMatch(styles, /public-landing-logo-heartbeat/);
  const breathe = styles.slice(
    styles.indexOf("@keyframes public-landing-logo-breathe"),
    styles.indexOf("@keyframes profile-avatar-ring-spin"),
  );
  assert.doesNotMatch(breathe, /opacity|width|height|margin|filter/);
  assert.match(landing, /<div className="public-landing-logo-motion">[\s\S]*<BrandImage/);
  assert.match(landing, /className="public-landing-logo-image/);
  assert.equal((landing.match(/public-landing-logo-motion/g) ?? []).length, 1);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*public-landing-logo-motion[\s\S]*animation:\s*none[\s\S]*transform:\s*none[\s\S]*will-change:\s*auto/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*profile-avatar-glow::before/);
});

test("profile editor keeps avatar first, responsive controls and non-reserved save feedback", async () => {
  const [editor, avatar, uploader, account] = await Promise.all([
    read("components", "profile", "profile-editor.tsx"),
    read("components", "profile", "profile-avatar-editor.tsx"),
    read("components", "media-upload.tsx"),
    read("components", "profile", "profile-account-settings.tsx"),
  ]);

  assert.match(editor, /onboarding \? "Paso esencial" : "Perfil"/);
  assert.doesNotMatch(editor, />Identidad</);
  assert.doesNotMatch(editor, /lg:grid-cols-\[15rem/);
  assert.doesNotMatch(editor, /className="min-h-5"/);
  assert.match(editor, /kind: "success"/);
  assert.match(editor, /markFormModified\(\)/);
  assert.match(editor, /aria-hidden="true"[^>]*>✓<\/span>/);
  assert.match(avatar, /JPEG, PNG o WebP · máximo 12 MB/);
  assert.match(uploader, />\s*Deshacer\s*</);
  assert.match(uploader, /flex-wrap gap-2/);
  assert.match(uploader, /min-h-11/);
  assert.match(account, />Sesión</);
  assert.ok(account.indexOf("<LogoutButton") < account.indexOf("<ProfileAccountAnonymization"));
});

test("season week calendar is one extracted table with progressive columns", async () => {
  const [page, table] = await Promise.all([
    read("app", "seasons", "[seasonId]", "page.tsx"),
    read("components", "season-weeks-table.tsx"),
  ]);

  assert.match(page, /import \{ SeasonWeeksTable \}/);
  assert.match(page, /<SeasonWeeksTable[\s\S]*weeks=\{seasonData\.weeks\}/);
  assert.doesNotMatch(page, /RealSeasonWeeksTable|function isSecretWeek/);
  assert.match(table, /tableClassName="season-weeks-table w-full table-fixed"/);
  assert.match(table, /w-14 md:w-16 lg:w-32/);
  assert.match(table, /<colgroup>/);
  assert.match(table, /<col \/>/);
  assert.match(table, />Semana<[\s\S]*>Juego<[\s\S]*>Fechas<[\s\S]*>Estado<[\s\S]*>Acción/);
  assert.match(table, /hidden px-4 py-3 text-left lg:table-cell">Fechas/);
  assert.match(table, /hidden px-3 py-3 text-left md:table-cell/);
  assert.match(table, /theme-text-muted lg:hidden/);
  assert.match(table, /className="mt-1 md:hidden"/);
  assert.match(table, /<StatusBadge compact/);
  assert.match(table, /className="lg:hidden">Ver</);
  assert.equal((table.match(/weeks\.map/g) ?? []).length, 1);
  assert.doesNotMatch(table, /MobileSeasonWeeksTable|DesktopSeasonWeeksTable/);
});
