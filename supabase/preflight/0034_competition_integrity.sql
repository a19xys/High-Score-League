-- Read-only preflight for 0034_competition_integrity.sql.
-- 0033 was historically retired; 0034 deliberately avoids reusing that identity.

select
  to_regclass('public.weeks') as weeks_table,
  to_regclass('public.launcher_packs') as launcher_packs_table,
  to_regclass('public.submissions') as submissions_table,
  to_regclass('public.week_competition_policies') as competition_policies_table;

select
  to_regprocedure('public.is_admin()') as is_admin_function,
  to_regprocedure('public.set_updated_at()') as set_updated_at_function,
  to_regprocedure('public.anonymize_profile_account(uuid)') as anonymization_function,
  to_regprocedure('public.guard_launcher_pack_lifecycle()') as launcher_pack_guard;

select version
from supabase_migrations.schema_migrations
where version in ('0026', '0027', '0031', '0032', '0033', '0034')
order by version;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'launcher_packs' and column_name in (
      'pack_id', 'week_id', 'size_bytes', 'sha256', 'status', 'published_at',
      'competition_manifest_sha256'
    ))
    or
    (table_name = 'submissions' and column_name in (
      'week_id', 'player_id', 'detected_at', 'duplicate_key',
      'launcher_pack_id', 'competition_integrity_version',
      'competition_manifest_sha256', 'competition_run_id',
      'competition_candidate_id'
    ))
    or table_name = 'week_competition_policies'
  )
order by table_name, ordinal_position;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('launcher_packs', 'submissions', 'week_competition_policies')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('submissions', 'week_competition_policies')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('launcher_packs', 'submissions', 'week_competition_policies')
order by tablename, indexname;

select
  relation.relname as table_name,
  constraint_record.conname as constraint_name,
  pg_get_constraintdef(constraint_record.oid) as definition
from pg_constraint constraint_record
join pg_class relation on relation.oid = constraint_record.conrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in ('launcher_packs', 'submissions', 'week_competition_policies')
order by relation.relname, constraint_record.conname;

select event_object_table as table_name, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('launcher_packs', 'submissions', 'week_competition_policies')
order by event_object_table, trigger_name, event_manipulation;
