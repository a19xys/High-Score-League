import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts: string[]) => readFile(join(root, ...parts), "utf8");

function policyStatement(sql: string, name: string) {
  const match = sql.match(
    new RegExp(`create\\s+policy\\s+${name}\\b[\\s\\S]*?;`, "i"),
  );

  assert.ok(match, `missing policy ${name}`);
  return match[0];
}

test("0032 replaces only profile SELECT with the narrow own-row bootstrap arm", async () => {
  const sql = await read(
    "supabase",
    "migrations",
    "0032_profile_bootstrap_rls.sql",
  );
  const selectPolicy = policyStatement(sql, "profiles_select_authenticated");

  assert.match(
    sql,
    /drop policy if exists profiles_select_authenticated on public\.profiles/i,
  );
  assert.match(selectPolicy, /for select\s+to authenticated/i);
  assert.match(selectPolicy, /public\.has_active_profile\(\)\s+or/i);
  assert.match(
    selectPolicy,
    /id\s*=\s*auth\.uid\(\)[\s\S]*auth\.uid\(\)\s+is not null[\s\S]*anonymized_at\s+is null/i,
  );
  assert.doesNotMatch(selectPolicy, /is_admin|raw_user_meta_data|using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(selectPolicy, /not\s+public\.has_active_profile|or\s+true/i);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.match(sql, /relation\.relrowsecurity = false/i);
});

test("the bootstrap authorization matrix denies foreign rows, tombstones and anonymous viewers", () => {
  function visible(input: {
    authenticated: boolean;
    viewerHasActiveProfile: boolean;
    ownRow: boolean;
    targetIsActive: boolean;
  }) {
    return (
      input.authenticated &&
      (input.viewerHasActiveProfile || (input.ownRow && input.targetIsActive))
    );
  }

  const cases = [
    ["pre-profile viewer / foreign active row", true, false, false, true, false],
    ["pre-profile viewer / own active row", true, false, true, true, true],
    ["active viewer / own active row", true, true, true, true, true],
    ["active viewer / normal-model foreign row", true, true, false, true, true],
    ["tombstone viewer / own tombstone", true, false, true, false, false],
    ["anonymous viewer / any profile", false, false, false, true, false],
  ] as const;

  for (const [
    label,
    authenticated,
    viewerHasActiveProfile,
    ownRow,
    targetIsActive,
    expected,
  ] of cases) {
    assert.equal(
      visible({
        authenticated,
        viewerHasActiveProfile,
        ownRow,
        targetIsActive,
      }),
      expected,
      label,
    );
  }
});

test("0032 preserves the 0027 active-profile, INSERT and UPDATE authorities", async () => {
  const [migration0032, migration0027] = await Promise.all([
    read("supabase", "migrations", "0032_profile_bootstrap_rls.sql"),
    read("supabase", "migrations", "0027_profile_anonymization.sql"),
  ]);
  const insertPolicy = policyStatement(migration0027, "profiles_insert_own");
  const updatePolicy = policyStatement(migration0027, "profiles_update_own");

  assert.doesNotMatch(
    migration0032,
    /create\s+(?:or replace\s+)?function\s+public\.has_active_profile|drop\s+function\s+(?:if exists\s+)?public\.has_active_profile/i,
  );
  assert.doesNotMatch(
    migration0032,
    /(?:drop|create)\s+policy\s+(?:if exists\s+)?profiles_(?:insert|update)_own/i,
  );
  assert.match(insertPolicy, /id\s*=\s*auth\.uid\(\)/i);
  assert.match(insertPolicy, /auth\.uid\(\)\s+is not null/i);
  assert.match(insertPolicy, /anonymized_at\s+is null/i);
  assert.match(insertPolicy, /is_admin\s*=\s*false/i);
  assert.match(insertPolicy, /lower\(username\)\s*!~\s*'\^deleted_'/i);
  assert.match(updatePolicy, /id\s*=\s*auth\.uid\(\)[\s\S]*anonymized_at\s+is null/i);
  assert.match(updatePolicy, /public\.has_active_profile\(\)/i);
});

test("0032 creates no alternate authority, trigger or profile backfill", async () => {
  const sql = await read(
    "supabase",
    "migrations",
    "0032_profile_bootstrap_rls.sql",
  );

  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function|create\s+trigger/i);
  assert.doesNotMatch(sql, /security definer|service_role|raw_user_meta_data/i);
  assert.doesNotMatch(sql, /^\s*(insert|update|delete)\s+(?:into|public\.)/im);
  assert.doesNotMatch(sql, /(insert|update|delete)\s+auth\.users/i);
});

test("0032 preflight is SELECT-only and reports dependencies, policies and orphan count", async () => {
  const sql = await read(
    "supabase",
    "preflight",
    "0032_profile_bootstrap_rls.sql",
  );
  const executable = sql.replace(/^--.*$/gm, "");

  assert.match(sql, /to_regclass\('public\.profiles'\)/i);
  assert.match(sql, /to_regprocedure\('public\.has_active_profile\(\)'\)/i);
  assert.match(sql, /column_name in \('id', 'username', 'initials', 'is_admin', 'anonymized_at'\)/i);
  assert.match(sql, /relation\.relrowsecurity as rls_enabled/i);
  assert.match(sql, /profiles_select_authenticated/i);
  assert.match(sql, /profiles_insert_own/i);
  assert.match(sql, /profiles_update_own/i);
  assert.match(
    sql,
    /from auth\.users auth_user[\s\S]*left join public\.profiles profile[\s\S]*where profile\.id is null/i,
  );
  assert.doesNotMatch(sql, /auth_user\.email|encrypted_password|raw_user_meta_data/i);
  assert.doesNotMatch(
    executable,
    /^\s*(alter|create|delete|drop|grant|insert|revoke|truncate|update)\b/im,
  );
});

test("ensureProfile keeps canonical RETURNING and primary-key race convergence", async () => {
  const source = await read("lib", "auth", "ensure-profile.ts");
  const initialRead = source.indexOf('.from("profiles")');
  const metadataRead = source.indexOf("user.user_metadata?.username");
  const validation = source.indexOf("validateUsername(username)");
  const insert = source.indexOf('.insert({');

  assert.ok(initialRead >= 0 && initialRead < metadataRead);
  assert.ok(metadataRead < validation && validation < insert);
  assert.match(
    source,
    /\.from\("profiles"\)[\s\S]*?\.select\(profileColumns\)[\s\S]*?\.eq\("id", user\.id\)[\s\S]*?\.maybeSingle\(\)/,
  );
  assert.match(
    source,
    /\.insert\(\{[\s\S]*?id: user\.id,[\s\S]*?username,[\s\S]*?initials,[\s\S]*?\}\)[\s\S]*?\.select\(profileColumns\)[\s\S]*?\.single\(\)/,
  );
  assert.match(
    source,
    /error\.code === "23505"[\s\S]*profiles_pkey[\s\S]*\.maybeSingle\(\)/i,
  );
});
