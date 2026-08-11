import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateUsername } from "../lib/auth/validation.ts";

const root = process.cwd();
const read = (...parts: string[]) => readFile(join(root, ...parts), "utf8");

test("0027 declares the lifecycle column and validates its 0025/0026 dependencies", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(sql, /add column if not exists anonymized_at timestamptz/i);
  assert.match(sql, /drop constraint if exists profiles_username_lifecycle_format/i);
  assert.match(sql, /create table if not exists public\.retired_profile_usernames/i);
  assert.match(sql, /0026 submissions_player_duplicate_key_unique_idx/i);
  assert.match(sql, /0025 play_time_events/i);
  assert.match(sql, /0025 player_game_play_time/i);
  assert.match(sql, /0025 player_play_time_totals/i);
  assert.match(sql, /0025 profiles\.play_time_public/i);
  assert.match(sql, /profile_anonymization_missing_dependencies/i);
});

test("the 0027 preflight is read-only and inventories Playtime, identity and avatars", async () => {
  const sql = await read("supabase", "preflight", "0027_profile_anonymization.sql");

  assert.match(sql, /supabase_migrations\.schema_migrations/i);
  assert.match(sql, /public\.play_time_events/i);
  assert.match(sql, /public\.player_game_play_time/i);
  assert.match(sql, /public\.player_play_time_totals/i);
  assert.match(sql, /lower\(username\) like 'deleted\\_%'/i);
  assert.match(sql, /administrator_profiles/i);
  assert.match(sql, /avatars\/<uid>|avatars\/\[0-9a-f-/i);
  assert.match(sql, /legacy chat \(optional\)[\s\S]*false/i);
  assert.doesNotMatch(sql, /from public\.chat_messages/i);
  assert.doesNotMatch(
    sql,
    /^\s*(alter|create|delete|drop|grant|insert|revoke|truncate|update)\s/im,
  );
});

test("the absent legacy chat table is optional and its policies are guarded", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(
    sql,
    /if to_regclass\('public\.chat_messages'\) is not null then[\s\S]*create policy chat_messages_select_visible[\s\S]*create policy chat_messages_insert_own/i,
  );
  assert.match(sql, /Optional legacy relation public\.chat_messages is absent; policies skipped/i);
  assert.doesNotMatch(sql, /^drop policy[^\n]+public\.chat_messages/im);
});

test("anonymous aliases are random, stable on retry and independent of the profile UUID", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(sql, /'deleted_' \|\| encode\(extensions\.gen_random_bytes\(12\), 'hex'\)/i);
  assert.match(sql, /username ~ '\^deleted_\[0-9a-f\]\{24\}\$'/i);
  assert.match(
    sql,
    /if current_profile\.anonymized_at is not null[\s\S]*current_profile\.username[\s\S]*true;/i,
  );
  assert.doesNotMatch(sql, /'deleted_'\s*\|\|\s*(p_profile_id|current_profile\.id)/i);
  assert.match(sql, /for attempt in 1\.\.32 loop[\s\S]*when unique_violation/i);
});

test("retired usernames use a private normalized fingerprint and active validation reserves deleted_", async () => {
  const [sql, validation] = await Promise.all([
    read("supabase", "migrations", "0027_profile_anonymization.sql"),
    read("lib", "auth", "validation.ts"),
  ]);

  assert.match(sql, /create table if not exists public\.retired_profile_usernames/i);
  assert.match(sql, /username_fingerprint text not null unique/i);
  assert.match(sql, /lower\(trim\(value\)\)/i);
  assert.match(sql, /extensions\.digest/i);
  assert.doesNotMatch(sql, /previous_username|retired_profile_usernames[\s\S]{0,200}username text/i);
  assert.match(sql, /message = 'username_retired'/i);
  assert.match(sql, /revoke all on table public\.retired_profile_usernames from public, anon, authenticated/i);
  assert.equal(validateUsername("deleted_alex"), "Ese username no está disponible.");
  assert.match(validation, /username_retired[\s\S]*Ese username no está disponible/);
});

test("DEL uniqueness applies only to active profiles and tombstones cannot be restored", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(
    sql,
    /create unique index profiles_initials_upper_unique_idx[\s\S]*where anonymized_at is null/i,
  );
  assert.match(sql, /initials = 'DEL'/i);
  assert.match(sql, /old\.anonymized_at is not null[\s\S]*message = 'profile_anonymized'/i);
  assert.match(sql, /profile_anonymization_service_role_required/i);
});

test("the DB barrier protects the last active admin", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('profile_anonymization_admin_guard'\)\)/i);
  assert.match(
    sql,
    /where profile\.is_admin = true[\s\S]*profile\.anonymized_at is null/i,
  );
  assert.match(sql, /if active_admin_count <= 1[\s\S]*message = 'last_admin'/i);
});

test("the DB barrier preserves history and removes only personal telemetry", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(
    sql,
    /update public\.submissions[\s\S]*raw_event = null[\s\S]*mame_version = null[\s\S]*client_version = null[\s\S]*duplicate_key = null/i,
  );
  assert.doesNotMatch(sql, /set[\s\S]{0,250}comment\s*=\s*null/i);
  assert.doesNotMatch(sql, /delete from public\.(submissions|weekly_results|season_memberships|league_chat_messages|home_poll_votes|chat_messages)/i);
  assert.doesNotMatch(sql, /update public\.weekly_results|update public\.home_poll_votes/i);
  assert.match(sql, /delete from public\.play_time_events[\s\S]*delete from public\.player_game_play_time[\s\S]*delete from public\.player_play_time_totals/i);
  assert.match(
    sql,
    /update public\.season_memberships[\s\S]*set status = 'left'[\s\S]*season\.status = 'active'/i,
  );
  assert.doesNotMatch(sql, /rom_name = null/i);
});

test("chat content is preserved except for the exact generated join message", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(
    sql,
    /update public\.league_chat_messages[\s\S]*content = generated_alias \|\| ' se unió al chat\.'[\s\S]*content = old_username \|\| ' se unió al chat\.'/i,
  );
  assert.doesNotMatch(sql, /like\s+'%|replace\s*\(|regexp_replace/i);
  assert.doesNotMatch(sql, /delete from public\.league_chat_messages/i);
});

test("authenticated read and write policies use the active-viewer barrier", async () => {
  const sql = await read("supabase", "migrations", "0027_profile_anonymization.sql");

  assert.match(sql, /create or replace function public\.has_active_profile\(\)/i);
  assert.match(sql, /profile\.id = auth\.uid\(\)[\s\S]*profile\.anonymized_at is null/i);
  assert.match(sql, /create or replace function public\.is_admin\(\)[\s\S]*profile\.anonymized_at is null[\s\S]*profile\.is_admin = true/i);

  for (const policy of [
    "profiles_select_authenticated",
    "seasons_select_authenticated",
    "games_select_authenticated",
    "weeks_select_authenticated",
    "submissions_select_visible",
    "weekly_results_select_authenticated",
    "season_memberships_select_authenticated",
    "league_chat_messages_select_authenticated",
    "home_polls_select_active",
    "home_poll_votes_insert_own_active_poll",
    "hsl_public_media_avatar_insert_own",
  ]) {
    assert.match(sql, new RegExp(`${policy}[\\s\\S]{0,900}has_active_profile\\(\\)`, "i"));
  }
});

test("the anonymization RPC is service-role-only and Auth uses supported soft deletion", async () => {
  const [sql, service] = await Promise.all([
    read("supabase", "migrations", "0027_profile_anonymization.sql"),
    read("lib", "account-anonymization.ts"),
  ]);

  assert.match(sql, /revoke all on function public\.anonymize_profile_account\(uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.anonymize_profile_account\(uuid\) to service_role/i);
  assert.match(service, /updateUserById\(userId,[\s\S]*user_metadata:/i);
  assert.match(service, /deleteUser\(userId, true\)/i);
  assert.doesNotMatch(service, /deleteUser\(userId\)(?!, true)/i);
  assert.doesNotMatch(sql, /delete from auth\.users|update auth\.users/i);
});

test("avatar cleanup is prefix-based and cannot touch product media", async () => {
  const service = await read("lib", "account-anonymization.ts");

  assert.match(service, /const folder = `avatars\/\$\{userId\}`/);
  assert.match(service, /\.list\(folder,/);
  assert.match(service, /\.remove\(paths\.slice/);
  assert.doesNotMatch(service, /games\/headers|games\/logos|polls\/options/);
});

test("public profile and preview queries reject tombstones with the same not-found path", async () => {
  const [profileData, previewData, page, previewRoute] = await Promise.all([
    read("lib", "data", "player-profile.ts"),
    read("lib", "data", "player-profile-preview.ts"),
    read("app", "players", "[username]", "page.tsx"),
    read("app", "api", "players", "[username]", "preview", "route.ts"),
  ]);

  assert.match(profileData, /\.is\("anonymized_at", null\)/);
  assert.match(previewData, /\.is\("anonymized_at", null\)/);
  assert.match(page, /status === "not-found"[\s\S]*notFound\(\)/);
  assert.match(previewRoute, /status === "not-found"[\s\S]*errorResponse\(404\)/);
  assert.doesNotMatch(page, /eliminó su cuenta|cuenta eliminada/i);
  assert.doesNotMatch(previewRoute, /anonymous_alias|historical metrics/i);
});

test("historical mappers retain tombstones while disabling profile interaction", async () => {
  const files = await Promise.all([
    read("lib", "data", "submissions.ts"),
    read("lib", "data", "weekly-results.ts"),
    read("lib", "data", "season-standings.ts"),
    read("lib", "data", "league-chat.ts"),
  ]);

  files.forEach((source) => assert.match(source, /anonymized_at/));
  assert.match(files[0], /isAnonymized = profile\.anonymized_at !== null/);
  assert.match(files[0], /isAdmin: isAnonymized \? false/);

  const [pill, hover] = await Promise.all([
    read("components", "player-pill.tsx"),
    read("components", "player-hover-card.tsx"),
  ]);
  assert.match(pill, /player\.isAnonymized \|\| !linkToProfile/);
  assert.match(hover, /if \(player\.isAnonymized\)[\s\S]*aria-label="Usuario eliminado"/);
  assert.match(hover, /cachedPreview = player\.isAnonymized[\s\S]*\? null/);
});

test("all mutation APIs explicitly require an active profile", async () => {
  const routes = await Promise.all([
    read("app", "api", "submissions", "ingest", "route.ts"),
    read("app", "api", "launcher", "playtime", "ingest", "route.ts"),
    read("app", "api", "seasons", "[seasonId]", "join", "route.ts"),
    read("app", "api", "home-poll", "vote", "route.ts"),
    read("app", "api", "chat", "messages", "route.ts"),
    read("app", "api", "chat", "messages", "[messageId]", "route.ts"),
  ]);

  routes.forEach((source) => {
    assert.match(source, /hasActiveProfile/);
    assert.match(source, /!profileState\.active/);
  });
});

test("profile lifecycle never sends a tombstone into onboarding", async () => {
  const [ensureProfile, profilePage] = await Promise.all([
    read("lib", "auth", "ensure-profile.ts"),
    read("app", "profile", "page.tsx"),
  ]);

  assert.match(ensureProfile, /status: "inaccessible"/);
  assert.match(profilePage, /profileResult\.status === "inaccessible"[\s\S]*redirect\("\/"\)/);
  assert.match(profilePage, /lifecycleProfile\?\.anonymized_at[\s\S]*redirect\("\/"\)/);
});

test("danger-zone confirmation is exact, acknowledged, accessible and single-flight", async () => {
  const ui = await read(
    "components",
    "profile",
    "profile-account-anonymization.tsx",
  );

  assert.match(ui, /confirmation === username && acknowledged && !submitting/);
  assert.match(ui, /Entiendo que esta acción es irreversible/);
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /if \(!canConfirm \|\| submittingRef\.current\)/);
  assert.match(ui, /Tus mensajes y comentarios conservarán su texto original/);
  assert.match(ui, /invalidatePlayerProfilePreview\(\{ playerId, usernames: \[username\] \}\)/);
});

test("player filters use stable IDs instead of anonymous labels", async () => {
  const [weeks, seasons] = await Promise.all([
    read("components", "weeks-table.tsx"),
    read("components", "seasons-table.tsx"),
  ]);

  assert.match(weeks, /option key=\{option\.id\} value=\{option\.id\}/);
  assert.match(seasons, /option key=\{option\.id\} value=\{option\.id\}/);
  assert.doesNotMatch(weeks, /value=\{option\.username\}/);
  assert.doesNotMatch(seasons, /value=\{option\.username\}/);
});
