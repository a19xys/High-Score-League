-- Read-only preflight for 0033_recovery_session_authorization.sql.
-- Run in the Supabase SQL editor after applying 0033. Every *_ok column should
-- be true and the final findings result set should contain zero rows.

select
  to_regprocedure('public.has_product_session()') is not null as authority_exists,
  coalesce(
    not (
      select proc.prosecdef
      from pg_proc proc
      where proc.oid = to_regprocedure('public.has_product_session()')
    ),
    false
  ) as authority_is_security_invoker,
  coalesce(
    has_function_privilege(
      'authenticated',
      to_regprocedure('public.has_product_session()'),
      'EXECUTE'
    ),
    false
  ) as authenticated_can_execute_authority,
  coalesce(
    not has_function_privilege(
      'anon',
      to_regprocedure('public.has_product_session()'),
      'EXECUTE'
    ),
    false
  ) as anon_cannot_execute_authority;

-- Live inventory: every public relation actually exposed to authenticated.
with authenticated_relations as (
  select
    relation.oid,
    namespace.nspname as schema_name,
    relation.relname as relation_name,
    relation.relrowsecurity as rls_enabled,
    array_remove(array[
      case when has_table_privilege('authenticated', relation.oid, 'SELECT') then 'SELECT' end,
      case when has_table_privilege('authenticated', relation.oid, 'INSERT') then 'INSERT' end,
      case when has_table_privilege('authenticated', relation.oid, 'UPDATE') then 'UPDATE' end,
      case when has_table_privilege('authenticated', relation.oid, 'DELETE') then 'DELETE' end
    ], null) as authenticated_privileges
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and (
      has_table_privilege('authenticated', relation.oid, 'SELECT')
      or has_table_privilege('authenticated', relation.oid, 'INSERT')
      or has_table_privilege('authenticated', relation.oid, 'UPDATE')
      or has_table_privilege('authenticated', relation.oid, 'DELETE')
    )
), barriers as (
  select
    policy.polrelid,
    bool_or(
      not policy.polpermissive
      and policy.polcmd = '*'
      and pg_get_expr(policy.polqual, policy.polrelid) like '%has_product_session%'
      and pg_get_expr(policy.polwithcheck, policy.polrelid) like '%has_product_session%'
    ) as has_product_session_barrier
  from pg_policy policy
  group by policy.polrelid
)
select
  authenticated_relations.schema_name,
  authenticated_relations.relation_name,
  authenticated_relations.authenticated_privileges,
  authenticated_relations.rls_enabled,
  coalesce(barriers.has_product_session_barrier, false) as has_product_session_barrier,
  authenticated_relations.rls_enabled
    and coalesce(barriers.has_product_session_barrier, false) as relation_ok
from authenticated_relations
left join barriers on barriers.polrelid = authenticated_relations.oid
order by authenticated_relations.schema_name, authenticated_relations.relation_name;

-- Policy inventory proves the barrier is RESTRICTIVE and applies to all DML.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  policy.polname as policy_name,
  not policy.polpermissive as is_restrictive,
  policy.polcmd = '*' as covers_all_commands,
  pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
  pg_get_expr(policy.polwithcheck, policy.polrelid) as with_check_expression
from pg_policy policy
join pg_class relation on relation.oid = policy.polrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
where policy.polname = 'hsl_product_session_barrier'
order by namespace.nspname, relation.relname;

-- Discover HSL-managed buckets from live Storage state. A single restrictive
-- storage.objects policy may cover several buckets; each discovered bucket is
-- checked against its predicate instead of relying on a copied table list.
with storage_barrier as (
  select
    pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
    pg_get_expr(policy.polwithcheck, policy.polrelid) as with_check_expression,
    not policy.polpermissive as is_restrictive,
    policy.polcmd = '*' as covers_all_commands
  from pg_policy policy
  where policy.polrelid = to_regclass('storage.objects')
    and policy.polname = 'hsl_product_session_barrier'
)
select
  bucket.id as bucket_id,
  coalesce(
    storage_barrier.is_restrictive
      and storage_barrier.covers_all_commands
      and storage_barrier.using_expression like '%has_product_session%'
      and storage_barrier.with_check_expression like '%has_product_session%'
      and storage_barrier.using_expression like '%' || bucket.id || '%'
      and storage_barrier.with_check_expression like '%' || bucket.id || '%',
    false
  ) as storage_barrier_ok
from storage.buckets bucket
left join storage_barrier on true
where bucket.id like 'hsl-%'
order by bucket.id;

-- Exhaustive live SECURITY DEFINER inventory. authenticated_executable rows
-- must either be trigger=false and guard_ok=true, or have no client execute.
select
  proc.oid::regprocedure::text as routine_signature,
  proc.prorettype = 'trigger'::regtype as is_trigger,
  has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    as authenticated_executable,
  pg_get_functiondef(proc.oid) ~
    'has_product_session|has_active_profile|is_admin' as guard_ok
from pg_proc proc
join pg_namespace namespace on namespace.oid = proc.pronamespace
where namespace.nspname = 'public'
  and proc.prosecdef
order by proc.oid::regprocedure::text;

-- Expected user-callable SECURITY DEFINER RPCs. Extra rows in the preceding
-- inventory are fine only if client EXECUTE is false; missing rows here are not.
with expected(signature) as (
  values
    ('public.has_active_profile()'),
    ('public.is_admin()'),
    ('public.get_week_hidden_submission_activity(uuid)'),
    ('public.is_latest_own_league_chat_message(uuid,timestamp with time zone)'),
    ('public.ingest_play_time_event(uuid,uuid,integer,text,timestamp with time zone,timestamp with time zone,text,text,text)')
)
select
  expected.signature,
  to_regprocedure(expected.signature) is not null as exists,
  coalesce(
    has_function_privilege(
      'authenticated',
      to_regprocedure(expected.signature),
      'EXECUTE'
    ),
    false
  ) as authenticated_can_execute
from expected
order by expected.signature;

-- Zero rows expected. This catches future authenticated table grants without
-- RLS/barrier, HSL Storage buckets outside the barrier, and unguarded elevated
-- RPCs (including accidental PUBLIC EXECUTE inherited by authenticated).
with authenticated_relations as (
  select relation.oid, namespace.nspname, relation.relname, relation.relrowsecurity
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and (
      has_table_privilege('authenticated', relation.oid, 'SELECT')
      or has_table_privilege('authenticated', relation.oid, 'INSERT')
      or has_table_privilege('authenticated', relation.oid, 'UPDATE')
      or has_table_privilege('authenticated', relation.oid, 'DELETE')
    )
), relation_findings as (
  select
    'authenticated_relation_without_recovery_barrier'::text as finding,
    format('%I.%I', relation.nspname, relation.relname) as object_name
  from authenticated_relations relation
  where not relation.relrowsecurity
    or not exists (
      select 1
      from pg_policy policy
      where policy.polrelid = relation.oid
        and not policy.polpermissive
        and policy.polcmd = '*'
        and pg_get_expr(policy.polqual, policy.polrelid) like '%has_product_session%'
        and pg_get_expr(policy.polwithcheck, policy.polrelid) like '%has_product_session%'
    )
), storage_findings as (
  select
    'hsl_storage_bucket_without_recovery_barrier'::text as finding,
    bucket.id::text as object_name
  from storage.buckets bucket
  where bucket.id like 'hsl-%'
    and not exists (
      select 1
      from pg_policy policy
      where policy.polrelid = to_regclass('storage.objects')
        and policy.polname = 'hsl_product_session_barrier'
        and not policy.polpermissive
        and policy.polcmd = '*'
        and pg_get_expr(policy.polqual, policy.polrelid) like '%has_product_session%'
        and pg_get_expr(policy.polwithcheck, policy.polrelid) like '%has_product_session%'
        and pg_get_expr(policy.polqual, policy.polrelid) like '%' || bucket.id || '%'
        and pg_get_expr(policy.polwithcheck, policy.polrelid) like '%' || bucket.id || '%'
    )
), routine_findings as (
  select
    'authenticated_security_definer_without_product_guard'::text as finding,
    proc.oid::regprocedure::text as object_name
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.prosecdef
    and has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    and (
      proc.prorettype = 'trigger'::regtype
      or pg_get_functiondef(proc.oid) !~
        'has_product_session|has_active_profile|is_admin'
    )
)
select * from relation_findings
union all
select * from storage_findings
union all
select * from routine_findings
order by finding, object_name;
