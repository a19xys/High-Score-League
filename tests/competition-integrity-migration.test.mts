import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts: string[]) => readFile(join(root, ...parts), "utf8");

test("0034 is deliberate and retired 0033 does not reappear", async () => {
  const [migrations, preflights, sql] = await Promise.all([
    readdir(join(root, "supabase", "migrations")),
    readdir(join(root, "supabase", "preflight")),
    read("supabase", "migrations", "0034_competition_integrity.sql"),
  ]);
  assert.ok(migrations.includes("0034_competition_integrity.sql"));
  assert.ok(preflights.includes("0034_competition_integrity.sql"));
  assert.equal(migrations.some((name) => name.startsWith("0033")), false);
  assert.equal(preflights.some((name) => name.startsWith("0033")), false);
  assert.match(sql, /0033 was historically retired[\s\S]*0034 is deliberate/i);
});

test("launcher pack manifest is canonical, nullable for legacy and immutable after publication", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  assert.match(sql, /alter table public\.launcher_packs[\s\S]*add column competition_manifest_sha256 text/i);
  assert.match(sql, /competition_manifest_sha256 is null[\s\S]*\^\[0-9a-f\]\{64\}\$/i);
  assert.match(sql, /unique \(pack_id, week_id\)/i);
  assert.match(sql, /new\.competition_manifest_sha256 is distinct from old\.competition_manifest_sha256/i);
  assert.match(sql, /protected policy pack requires its canonical manifest/i);
  assert.doesNotMatch(sql, /space-invaders-s1-w1-r[12]|782a2ca4/i);
});

test("private week policy is fixed v1, same-week pack bound and frozen after the first Protected row", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  assert.match(sql, /create table public\.week_competition_policies/i);
  for (const contract of [
    /policy_version smallint[\s\S]*policy_version = 1/i,
    /mode text[\s\S]*mode = 'protected_v2'/i,
    /evidence_version smallint[\s\S]*evidence_version = 2/i,
    /guard_version smallint[\s\S]*guard_version = 2/i,
    /source text[\s\S]*source = 'mame_memory'/i,
    /jsonb_typeof\(dips\) = 'array'[\s\S]*jsonb_array_length\(dips\) <= 32/i,
    /foreign key \(launcher_pack_id, week_id\)[\s\S]*launcher_packs\(pack_id, week_id\)/i,
  ]) assert.match(sql, contract);
  assert.match(sql, /competition_integrity_version = 2[\s\S]*policy is frozen after its first protected submission/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /week_competition_policies_admin_all[\s\S]*public\.is_admin\(\)/i);
  assert.match(sql, /revoke all on table public\.week_competition_policies from public, anon/i);
});

test("submissions persist normalized Protected identity with candidate and DB guard backstops", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  for (const column of [
    "launcher_pack_id", "competition_integrity_version", "competition_manifest_sha256",
    "competition_run_id", "competition_candidate_id",
  ]) assert.match(sql, new RegExp(`add column ${column}`, "i"));
  assert.match(sql, /submissions_competition_identity_all_or_none_check/i);
  assert.match(sql, /competition_integrity_version = 2[\s\S]*launcher_pack_id is not null[\s\S]*competition_manifest_sha256 is not null/i);
  assert.match(sql, /create unique index submissions_protected_candidate_unique_idx[\s\S]*player_id[\s\S]*launcher_pack_id[\s\S]*competition_run_id[\s\S]*competition_candidate_id[\s\S]*where competition_integrity_version = 2/i);
  assert.match(sql, /create trigger submissions_guard_competition_integrity[\s\S]*before insert/i);
  for (const guard of [
    /new\.launcher_pack_id is distinct from policy\.launcher_pack_id/i,
    /new\.competition_manifest_sha256 is distinct from pack\.competition_manifest_sha256/i,
    /new\.rom_name is distinct from policy\.rom_name/i,
    /new\.mame_version is distinct from policy\.mame_version/i,
    /new\.source is distinct from policy\.source/i,
    /new\.duplicate_key !~ '\^hsl:v2:\[0-9a-f\]\{64\}\$'/i,
    /pack\.published_at is null/i,
    /pack\.status not in \('published', 'disabled'\)/i,
  ]) assert.match(sql, guard);
});

test("authenticated direct INSERT and the old admin all-policy are removed", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  assert.match(sql, /drop policy if exists submissions_insert_own/i);
  assert.match(sql, /drop policy if exists submissions_admin_all/i);
  assert.match(sql, /revoke insert on table public\.submissions from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.submissions to service_role/i);
  assert.doesNotMatch(sql, /create policy submissions_[^\n]*insert[\s\S]{0,120}to authenticated/i);
  assert.match(sql, /submissions_admin_select/i);
  assert.match(sql, /submissions_admin_update/i);
  assert.match(sql, /submissions_admin_delete/i);
});

test("anonymization preserves canonical competition history and clears individual technical IDs", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  const anonymization = sql.slice(sql.indexOf("create or replace function public.anonymize_profile_account"));
  assert.match(anonymization, /raw_event = null[\s\S]*duplicate_key = null[\s\S]*competition_run_id = null[\s\S]*competition_candidate_id = null/i);
  assert.doesNotMatch(anonymization, /launcher_pack_id = null|competition_integrity_version = null|competition_manifest_sha256 = null/i);
  assert.match(sql, /competition_run_id is null[\s\S]*competition_candidate_id is null/i);
});

test("0034 preflight is SELECT-only and inventories dependencies, policies, grants and phase state", async () => {
  const sql = await read("supabase", "preflight", "0034_competition_integrity.sql");
  for (const dependency of [
    "public.weeks", "public.launcher_packs", "public.submissions",
    "public.is_admin()", "public.set_updated_at()", "0026", "0027", "0031", "0032",
    "competition_manifest_sha256", "week_competition_policies", "pg_policies",
    "role_table_grants", "pg_indexes", "pg_constraint", "information_schema.triggers",
  ]) assert.match(sql, new RegExp(dependency.replace(/[().]/g, "\\$&"), "i"));
  assert.match(sql, /tablename in \('launcher_packs', 'submissions', 'week_competition_policies'\)/i);
  assert.doesNotMatch(sql, /^\s*(alter|create|delete|do|drop|grant|insert|revoke|truncate|update)\s/im);
});

test("WEB wiring uses authenticated client only for identity/profile and admin client for normalized persistence", async () => {
  const [route, resolver, types] = await Promise.all([
    read("app", "api", "submissions", "ingest", "route.ts"),
    read("lib", "api", "submission-ingest.ts"),
    read("types", "supabase.ts"),
  ]);
  assert.match(route, /createCookieOrBearerAuthenticatedClient[\s\S]*auth\.getUser/);
  assert.match(route, /hasActiveProfile\(authenticatedClient/);
  assert.match(route, /createAdminClient: createSupabaseAdminClient/);
  assert.doesNotMatch(route, /\.from\(|\.insert\(/);
  assert.match(resolver, /player_id: userId/);
  assert.doesNotMatch(resolver, /submitted_at:\s*(input|payload|row)\b/);
  assert.match(types, /competition_manifest_sha256\?: string \| null/);
  assert.match(types, /WeekCompetitionPolicyRow/);
  assert.match(types, /competition_candidate_id\?: string \| null/);
});
