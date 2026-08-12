import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatLeaguePointsDelta } from "../lib/format.ts";
import { createMediaStoragePath, isValidMediaStoragePath } from "../lib/media/paths.ts";
import { MEDIA_PRESETS } from "../lib/media/presets.ts";
import { getPublicMediaUrl } from "../lib/media/resolver.ts";
import { getPlayerPresencePresentation } from "../lib/player-presence-presentation.ts";

const read = (...parts: string[]) => readFile(join(process.cwd(), ...parts), "utf8");
const objectId = "22222222-2222-4222-8222-222222222222";

test("official results render only rank, player and signed league points", async () => {
  const source = await read("components", "week-detail-view.tsx");
  const section = source.slice(
    source.indexOf('title="Resultados oficiales"'),
    source.indexOf('title="Historial de envíos"'),
  );

  for (const label of ["Puesto", "Jugador", "Puntos"]) assert.match(section, new RegExp(label));
  assert.doesNotMatch(section, /Puntuación|finalScore|formatScore/);
  assert.match(section, /table-fixed/);
  assert.match(section, /PlayerPill compactOnMobile/);
  assert.deepEqual([6, 3, 1, 0].map(formatLeaguePointsDelta), ["+6", "+3", "+1", "+0"]);
});

test("benchmark media preset and path contract are exact", () => {
  assert.deepEqual(
    [
      MEDIA_PRESETS["benchmark-icon"].maxWidth,
      MEDIA_PRESETS["benchmark-icon"].maxHeight,
      MEDIA_PRESETS["benchmark-icon"].pathPrefix,
    ],
    [256, 256, "benchmarks/icons"],
  );
  const path = createMediaStoragePath("benchmark-icon", { uuid: () => objectId });
  assert.equal(path, `benchmarks/icons/${objectId}.webp`);
  assert.equal(isValidMediaStoragePath(path, "benchmark-icon"), true);
  assert.equal(isValidMediaStoragePath(`benchmarks/${objectId}.webp`, "benchmark-icon"), false);
  assert.equal(isValidMediaStoragePath(`polls/options/${objectId}.webp`, "benchmark-icon"), false);
  assert.equal(isValidMediaStoragePath(`Benchmarks/icons/${objectId}.webp`, "benchmark-icon"), false);
});

test("benchmark API payload contract accepts only its managed path", async () => {
  const validation = await read("lib", "admin", "weeks.ts");
  assert.match(validation, /payload\.imageUrl !== undefined/);
  assert.match(validation, /isValidMediaStoragePath\(imageStoragePath\.value, "benchmark-icon"\)/);
  assert.match(validation, /image_storage_path: imageStoragePath\.value/);
  assert.doesNotMatch(validation, /icon_key: iconKeyValue/);

  assert.equal(
    isValidMediaStoragePath(`benchmarks/icons/${objectId}.webp`, "benchmark-icon"),
    true,
  );
  assert.equal(isValidMediaStoragePath("https://example.com/a.webp", "benchmark-icon"), false);
  assert.equal(isValidMediaStoragePath(`polls/options/${objectId}.webp`, "benchmark-icon"), false);
});

test("benchmark mapping resolves managed images and preserves null for REF fallback", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  const path = `benchmarks/icons/${objectId}.webp`;
  assert.equal(
    getPublicMediaUrl(path),
    `https://project.supabase.co/storage/v1/object/public/hsl-public-media/${path}`,
  );
  assert.equal(getPublicMediaUrl(null), null);
  const mapping = await read("lib", "data", "week-benchmarks.ts");
  assert.match(mapping, /imageStoragePath: row\.image_storage_path/);
  assert.match(mapping, /imageUrl: getPublicMediaUrl\(row\.image_storage_path\)/);
});

test("0030 adds the nullable constrained path and exact admin storage policies", async () => {
  const [migration, preflight] = await Promise.all([
    read("supabase", "migrations", "0030_week_benchmark_images.sql"),
    read("supabase", "preflight", "0030_week_benchmark_images.sql"),
  ]);
  assert.match(migration, /add column image_storage_path text/i);
  assert.match(migration, /week_benchmarks_image_storage_path_check/i);
  assert.match(migration, /\^benchmarks\/icons\/\[0-9a-f\]\{8\}/i);
  for (const operation of ["insert", "select", "delete"]) {
    assert.match(migration, new RegExp(`benchmark_icon_admin_${operation}[\\s\\S]*for ${operation}[\\s\\S]*public\\.is_admin`, "i"));
  }
  assert.doesNotMatch(migration, /drop column[\s\S]*icon_key/i);
  assert.match(preflight, /image_storage_path_columns/);
  assert.match(preflight, /benchmarks_with_legacy_icon_key/);
  assert.match(preflight, /hsl-public-media/);
});

test("admin benchmark UI uses shared managed media fields and no preset icon selector", async () => {
  const [manager, leaderboard, deleteRoute] = await Promise.all([
    read("components", "admin-benchmarks-manager.tsx"),
    read("components", "leaderboard-table.tsx"),
    read("app", "api", "admin", "weeks", "[weekId]", "benchmarks", "[benchmarkId]", "route.ts"),
  ]);
  assert.match(manager, /function BenchmarkEditorFields/);
  assert.match(manager, /preset="benchmark-icon"/);
  assert.match(manager, /executeMediaSave/);
  assert.doesNotMatch(manager, /BENCHMARK_ICON_KEYS|IconSelect|BenchmarkIconPreview|speedometer/);
  assert.match(leaderboard, />\s*REF\s*</);
  assert.match(leaderboard, /object-contain/);
  assert.doesNotMatch(leaderboard, /mask|speedometer|BenchmarkReferenceIcon/);
  assert.match(deleteRoute, /select\("id,image_storage_path"\)[\s\S]*\.delete\(\)[\s\S]*deleteManagedMedia/);
  assert.match(deleteRoute, /cleanupWarning/);
});

test("MediaUpload state copy is mutually exclusive and profile action stays natural-width", async () => {
  const [upload, editor, avatar] = await Promise.all([
    read("components", "media-upload.tsx"),
    read("components", "profile", "profile-editor.tsx"),
    read("components", "profile", "profile-avatar-editor.tsx"),
  ]);
  const replaceBranch = upload.slice(
    upload.indexOf('{selection.kind === "replace"'),
    upload.indexOf(') : selection.kind === "remove"'),
  );
  assert.match(replaceBranch, /Imagen lista:/);
  assert.doesNotMatch(replaceBranch, /JPEG, PNG o WebP/);
  assert.match(upload, /Se quitará al guardar/);
  assert.match(upload, /JPEG, PNG o WebP/);
  assert.match(avatar, /label="Foto de perfil"/);
  assert.doesNotMatch(avatar, /Avatar público/);
  const saveButton = editor.slice(editor.indexOf('type="submit"') - 700, editor.indexOf('type="submit"') + 100);
  assert.match(saveButton, /w-fit/);
  assert.doesNotMatch(saveButton, /w-full/);
});

test("Presence presentation supplies text plus color and hides private compact states", () => {
  assert.equal(getPlayerPresencePresentation({ visibility: "visible", status: "offline" })?.label, "Desconectado");
  assert.equal(getPlayerPresencePresentation({ visibility: "visible", status: "connected", sources: ["web"] })?.label, "Conectado");
  const playing = getPlayerPresencePresentation({ visibility: "visible", status: "playing", game: { id: "g1", title: "Pac-Man" } });
  assert.deepEqual([playing?.label, playing?.detail], ["Jugando", "Pac-Man"]);
  assert.equal(getPlayerPresencePresentation({ visibility: "visible", status: "playing", game: null })?.label, "Jugando");
  assert.equal(getPlayerPresencePresentation({ visibility: "private" })?.label, "Privado");
  const compactPlaying = getPlayerPresencePresentation(
    { visibility: "visible", status: "playing", game: { id: "g1", title: "Pac-Man" } },
    "compact",
  );
  assert.deepEqual([compactPlaying?.label, compactPlaying?.ariaLabel], ["Pac-Man", "Jugando a Pac-Man"]);
  assert.equal(getPlayerPresencePresentation({ visibility: "private" }, "compact"), null);
  assert.equal(getPlayerPresencePresentation({ visibility: "unavailable" }, "compact"), null);
});

test("hover Presence is a fresh parallel snapshot and does not enter preview cache", async () => {
  const hover = await read("components", "player-hover-card.tsx");
  assert.match(hover, /requestPlayerPresence[\s\S]*\/presence/);
  assert.match(hover, /cache: "no-store"/);
  assert.match(hover, /requestPlayerPresence\(player\)/);
  assert.match(hover, /requestPlayerPreview\(player\)/);
  assert.match(hover, /PlayerPresenceIndicator[\s\S]*variant="compact"/);
  assert.doesNotMatch(hover, /setInterval[\s\S]*requestPlayerPresence/);
  const cache = await read("lib", "player-profile-preview-cache.ts");
  assert.doesNotMatch(cache, /presence/i);
});
