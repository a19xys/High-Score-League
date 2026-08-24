import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts: string[]) => readFile(join(root, ...parts), "utf8");

function referencePolicyFingerprint(overrides: Record<string, unknown> = {}) {
  const source = {
    policy_version: 1,
    mode: "protected_v2",
    week_id: "22222222-2222-4222-8222-222222222222",
    launcher_pack_id: "fixture-pack-r2",
    evidence_version: 2,
    guard_version: 2,
    rom_name: "invaders",
    mame_version: "0.287",
    plugin_version: "0.4.0",
    source: "mame_memory",
    dips: [{ portTag: ":IN2", mask: 3, value: 0 }, { portTag: ":IN2", mask: 8, value: 0 }],
    ...overrides,
  };
  const contract = {
    policy_version: source.policy_version,
    mode: source.mode,
    week_id: source.week_id,
    launcher_pack_id: source.launcher_pack_id,
    evidence_version: source.evidence_version,
    guard_version: source.guard_version,
    rom_name: source.rom_name,
    mame_version: source.mame_version,
    plugin_version: source.plugin_version,
    source: source.source,
    dips: source.dips,
  };
  return createHash("sha256").update(JSON.stringify(contract), "utf8").digest("hex");
}

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
  assert.equal(migrations.some((name) => name.startsWith("0035")), false);
  assert.equal(preflights.some((name) => name.startsWith("0035")), false);
  assert.match(sql, /0033 was historically retired[\s\S]*0034 is deliberate/i);
});

test("launcher pack manifest is canonical, nullable for legacy and immutable after publication", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  assert.match(sql, /alter table public\.launcher_packs[\s\S]*add column competition_manifest_sha256 text/i);
  assert.match(sql, /competition_manifest_sha256 is null[\s\S]*\^\[0-9a-f\]\{64\}\$/i);
  assert.match(sql, /unique \(pack_id, week_id\)/i);
  assert.match(sql, /new\.competition_manifest_sha256 is distinct from old\.competition_manifest_sha256/i);
  assert.match(sql, /protected policy pack requires its canonical manifest/i);
  assert.match(sql, /old\.status = 'published' and new\.status = 'disabled'[\s\S]*policy\.frozen_at is null[\s\S]*unfrozen competition policy pack cannot be disabled/i);
  assert.doesNotMatch(sql, /space-invaders-s1-w1-r[12]|782a2ca4/i);
});

test("private week policy is fixed v1, fingerprinted and frozen monotonically", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  assert.match(sql, /create table public\.week_competition_policies/i);
  for (const contract of [
    /policy_version smallint[\s\S]*policy_version = 1/i,
    /mode text[\s\S]*mode = 'protected_v2'/i,
    /evidence_version smallint[\s\S]*evidence_version = 2/i,
    /guard_version smallint[\s\S]*guard_version = 2/i,
    /source text[\s\S]*source = 'mame_memory'/i,
    /jsonb_typeof\(dips\) = 'array'[\s\S]*jsonb_array_length\(dips\) <= 32/i,
    /policy_fingerprint text not null/i,
    /frozen_at timestamptz/i,
    /foreign key \(launcher_pack_id, week_id\)[\s\S]*launcher_packs\(pack_id, week_id\)/i,
  ]) assert.match(sql, contract);
  const policyGuard = sql.slice(
    sql.indexOf("create or replace function public.guard_week_competition_policy"),
    sql.indexOf("create trigger week_competition_policies_guard"),
  );
  assert.match(policyGuard, /old\.frozen_at is not null[\s\S]*frozen competition policy cannot be deleted/i);
  assert.match(policyGuard, /new\.frozen_at is distinct from old\.frozen_at[\s\S]*frozen competition policy is immutable/i);
  assert.match(policyGuard, /for update/i);
  assert.match(policyGuard, /new or retargeted competition policy cannot use a disabled pack/i);
  assert.match(policyGuard, /new\.policy_fingerprint := public\.compute_week_competition_policy_fingerprint/i);
  assert.doesNotMatch(policyGuard, /from public\.submissions|competition_integrity_version = 2/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /week_competition_policies_admin_all[\s\S]*public\.is_admin\(\)/i);
  assert.match(sql, /revoke all on table public\.week_competition_policies from public, anon/i);
});

test("policy fingerprint covers the full contract and excludes lifecycle timestamps", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  const fingerprint = sql.slice(
    sql.indexOf("create or replace function public.compute_week_competition_policy_fingerprint"),
    sql.indexOf("create table public.week_competition_policies"),
  );
  for (const field of [
    "policy_version", "mode", "week_id", "launcher_pack_id", "evidence_version",
    "guard_version", "rom_name", "mame_version", "plugin_version", "source", "dips",
  ]) assert.match(fingerprint, new RegExp(`'${field}'`, "i"));
  assert.match(fingerprint, /extensions\.digest[\s\S]*jsonb_build_object[\s\S]*'sha256'[\s\S]*'hex'/i);
  assert.doesNotMatch(fingerprint, /created_at|updated_at|frozen_at/i);

  const baseline = referencePolicyFingerprint();
  const changes = [
    { plugin_version: "0.4.1" },
    { dips: [{ portTag: ":IN2", mask: 3, value: 1 }, { portTag: ":IN2", mask: 8, value: 0 }] },
    { dips: [{ portTag: ":IN2", mask: 7, value: 0 }, { portTag: ":IN2", mask: 8, value: 0 }] },
    { dips: [{ portTag: ":IN2", mask: 8, value: 0 }, { portTag: ":IN2", mask: 3, value: 0 }] },
    { mame_version: "0.288" },
    { rom_name: "invaders2" },
    { launcher_pack_id: "fixture-pack-r3" },
    { guard_version: 3 },
    { evidence_version: 3 },
    { source: "other" },
  ];
  changes.forEach((change) => assert.notEqual(referencePolicyFingerprint(change), baseline));
  assert.equal(referencePolicyFingerprint({ updated_at: "2027-01-01T00:00:00Z" }), baseline);
  assert.equal(referencePolicyFingerprint({ frozen_at: "2027-01-01T00:00:00Z" }), baseline);
});

test("submissions persist normalized Protected identity with candidate and DB guard backstops", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  for (const column of [
    "launcher_pack_id", "competition_integrity_version", "competition_manifest_sha256",
    "competition_policy_fingerprint", "competition_run_id", "competition_candidate_id",
  ]) assert.match(sql, new RegExp(`add column ${column}`, "i"));
  assert.match(sql, /submissions_competition_identity_all_or_none_check/i);
  assert.match(sql, /competition_integrity_version = 2[\s\S]*launcher_pack_id is not null[\s\S]*competition_manifest_sha256 is not null[\s\S]*competition_policy_fingerprint is not null/i);
  assert.match(sql, /create unique index submissions_protected_candidate_unique_idx[\s\S]*player_id[\s\S]*launcher_pack_id[\s\S]*competition_run_id[\s\S]*competition_candidate_id[\s\S]*where competition_integrity_version = 2/i);
  assert.match(sql, /create trigger submissions_guard_competition_integrity[\s\S]*before insert/i);
  for (const guard of [
    /new\.launcher_pack_id is distinct from policy\.launcher_pack_id/i,
    /new\.competition_manifest_sha256 is distinct from pack\.competition_manifest_sha256/i,
    /new\.competition_policy_fingerprint is distinct from policy\.policy_fingerprint/i,
    /new\.rom_name is distinct from policy\.rom_name/i,
    /new\.mame_version is distinct from policy\.mame_version/i,
    /new\.source is distinct from policy\.source/i,
    /new\.duplicate_key !~ '\^hsl:v2:\[0-9a-f\]\{64\}\$'/i,
    /pack\.published_at is null/i,
    /policy\.frozen_at is null and pack\.status <> 'published'/i,
    /policy\.frozen_at is not null and pack\.status not in \('published', 'disabled'\)/i,
  ]) assert.match(sql, guard);
  const insertGuard = sql.slice(
    sql.indexOf("create or replace function public.guard_submission_competition_integrity"),
    sql.indexOf("create trigger submissions_guard_competition_integrity"),
  );
  assert.match(insertGuard, /week_competition_policies[\s\S]*for update/i);
  assert.match(insertGuard, /launcher_packs[\s\S]*for update/i);
  assert.match(insertGuard, /security definer/i);
  assert.match(insertGuard, /errcode = '40001'/i);
  assert.match(insertGuard, /set frozen_at = statement_timestamp\(\)/i);
});

test("Protected history is immutable while moderation and the exact privacy scrub remain possible", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  const historyGuard = sql.slice(
    sql.indexOf("create or replace function public.guard_submission_competition_history"),
    sql.indexOf("create trigger submissions_guard_competition_history"),
  );
  for (const field of [
    "week_id", "player_id", "score", "source", "detected_at", "rom_name",
    "launcher_pack_id", "competition_integrity_version", "competition_manifest_sha256",
    "competition_policy_fingerprint",
  ]) assert.match(historyGuard, new RegExp(`new\\.${field} is distinct from old\\.${field}`, "i"));
  for (const field of [
    "raw_event", "mame_version", "client_version", "duplicate_key",
    "competition_run_id", "competition_candidate_id",
  ]) assert.match(historyGuard, new RegExp(`new\\.${field} is null`, "i"));
  assert.doesNotMatch(historyGuard, /auth\.role\(\).*service_role/i);
  assert.match(sql, /create trigger submissions_guard_competition_history[\s\S]*before update on public\.submissions/i);
});

test("authenticated writes are limited to moderation columns and never DELETE submissions", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  assert.match(sql, /drop policy if exists submissions_insert_own/i);
  assert.match(sql, /drop policy if exists submissions_admin_all/i);
  assert.match(sql, /revoke insert, update, delete on table public\.submissions from anon, authenticated/i);
  assert.match(sql, /grant select on table public\.submissions to authenticated/i);
  assert.match(sql, /grant update \(is_valid, is_hidden\) on table public\.submissions to authenticated/i);
  assert.doesNotMatch(sql, /grant (?:select, )?update, delete on table public\.submissions to authenticated/i);
  assert.doesNotMatch(sql, /grant update on table public\.submissions to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.submissions to service_role/i);
  assert.doesNotMatch(sql, /create policy submissions_[^\n]*insert[\s\S]{0,120}to authenticated/i);
  assert.match(sql, /submissions_admin_select/i);
  assert.match(sql, /submissions_admin_update/i);
  assert.doesNotMatch(sql, /create policy submissions_admin_delete/i);
});

test("the two authenticated admin flows need only is_valid, is_hidden and SELECT", async () => {
  const [adminRoute, reconcile] = await Promise.all([
    read("app", "api", "admin", "submissions", "[submissionId]", "route.ts"),
    read("lib", "admin", "reconcile-week.ts"),
  ]);
  assert.match(adminRoute, /\.update\(\{ is_valid: payload\.isValid \}\)[\s\S]*\.select\("id,is_valid"\)/i);
  assert.doesNotMatch(adminRoute, /\.delete\(\)|competition_|week_id|player_id|score:/i);
  assert.match(reconcile, /\.update\(\{ is_hidden: false \}\)/i);
  assert.match(reconcile, /\.update\(\{ is_hidden: true \}\)/i);
  assert.doesNotMatch(reconcile, /\.from\("submissions"\)[\s\S]{0,120}\.delete\(\)/i);
});

test("anonymization preserves canonical competition history and clears individual technical IDs", async () => {
  const sql = await read("supabase", "migrations", "0034_competition_integrity.sql");
  const anonymization = sql.slice(sql.indexOf("create or replace function public.anonymize_profile_account"));
  assert.match(anonymization, /raw_event = null[\s\S]*duplicate_key = null[\s\S]*competition_run_id = null[\s\S]*competition_candidate_id = null/i);
  assert.doesNotMatch(anonymization, /launcher_pack_id = null|competition_integrity_version = null|competition_manifest_sha256 = null|competition_policy_fingerprint = null/i);
  assert.match(sql, /competition_run_id is null[\s\S]*competition_candidate_id is null/i);
});

test("0034 preflight is SELECT-only and inventories dependencies, policies, grants and phase state", async () => {
  const sql = await read("supabase", "preflight", "0034_competition_integrity.sql");
  for (const dependency of [
    "public.weeks", "public.launcher_packs", "public.submissions",
    "public.is_admin()", "public.set_updated_at()", "0026", "0027", "0031", "0032",
    "competition_manifest_sha256", "competition_policy_fingerprint", "policy_fingerprint",
    "frozen_at", "week_competition_policies", "pg_policies", "column_privileges",
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
  assert.match(types, /competition_policy_fingerprint\?: string \| null/);
  assert.match(types, /WeekCompetitionPolicyRow/);
  assert.match(types, /policy_fingerprint: string/);
  assert.match(types, /frozen_at: string \| null/);
  assert.match(types, /competition_candidate_id\?: string \| null/);
});
