-- DB-PROFILE-BOOTSTRAP-RLS-1 / 0032 preflight (read-only).
-- Run before applying 0032_profile_bootstrap_rls.sql.
-- Every statement is SELECT-only and never changes schema, policies or data.

-- 1. Migration history around the required baseline and this pending migration.
select version, name
from supabase_migrations.schema_migrations
where version in ('0027', '0031', '0032')
order by version;

-- 2. Structural dependencies and the active-profile authority.
select
  to_regclass('public.profiles') as profiles_table,
  to_regprocedure('public.has_active_profile()') as has_active_profile_function;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('id', 'username', 'initials', 'is_admin', 'anonymized_at')
order by ordinal_position;

select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as rls_forced
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'profiles'
  and relation.relkind in ('r', 'p');

-- 3. Current policies. The SELECT output makes missing or divergent policies
--    visible without assuming that 0027 matches the repository byte-for-byte.
select
  required.policyname as required_policy,
  required.expected_command,
  policy.policyname is not null as present,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check
from (
  values
    ('profiles_select_authenticated', 'SELECT'),
    ('profiles_insert_own', 'INSERT'),
    ('profiles_update_own', 'UPDATE')
) as required(policyname, expected_command)
left join pg_policies policy
  on policy.schemaname = 'public'
 and policy.tablename = 'profiles'
 and policy.policyname = required.policyname
order by required.policyname;

-- 4. Audit only: count Auth identities that still need a public profile.
--    No email, password material, tokens or raw metadata are returned.
select count(*) as auth_users_without_profile
from auth.users auth_user
left join public.profiles profile on profile.id = auth_user.id
where profile.id is null;
