-- Treat a Supabase recovery credential as a restricted Auth capability, not
-- as an HSL product session. Apply after 0032_profile_bootstrap_rls.sql.

begin;

do $recovery_authorization_dependencies$
declare
  missing_dependencies text[] := array[]::text[];
  unprotected_relation text;
begin
  if to_regprocedure('public.has_active_profile()') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.has_active_profile()');
  end if;

  if to_regprocedure('public.is_admin()') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.is_admin()');
  end if;

  if to_regprocedure(
    'public.ingest_play_time_event(uuid,uuid,integer,text,timestamp with time zone,timestamp with time zone,text,text,text)'
  ) is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.ingest_play_time_event(uuid,uuid,integer,text,timestamptz,timestamptz,text,text,text)'
    );
  end if;

  if to_regclass('storage.objects') is null then
    missing_dependencies := array_append(missing_dependencies, 'storage.objects');
  end if;

  if not exists (
    select 1
    from pg_policy policy
    where policy.polrelid = to_regclass('public.profiles')
      and policy.polname = 'profiles_select_authenticated'
      and pg_get_expr(policy.polqual, policy.polrelid) like '%has_active_profile%'
      and pg_get_expr(policy.polqual, policy.polrelid) like '%auth.uid%'
      and pg_get_expr(policy.polqual, policy.polrelid) like '%anonymized_at%'
  ) then
    missing_dependencies := array_append(
      missing_dependencies,
      '0032 profiles_select_authenticated policy'
    );
  end if;

  select format('%I.%I', namespace.nspname, relation.relname)
  into unprotected_relation
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
    and not relation.relrowsecurity
  order by relation.relname
  limit 1;

  if unprotected_relation is not null then
    missing_dependencies := array_append(
      missing_dependencies,
      format('%s row level security', unprotected_relation)
    );
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'recovery_session_authorization_missing_dependencies',
      detail = array_to_string(missing_dependencies, ', ');
  end if;
end
$recovery_authorization_dependencies$;

-- This is deliberately SECURITY INVOKER. It reads only signed request claims.
-- Missing AMR remains product-compatible for historical normal sessions;
-- present but malformed AMR fails closed.
create or replace function public.has_product_session()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  request_claims jsonb := auth.jwt();
  authentication_methods jsonb;
  authentication_method jsonb;
  method_name text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    return false;
  end if;

  authentication_methods := request_claims -> 'amr';

  if authentication_methods is null then
    return true;
  end if;

  if jsonb_typeof(authentication_methods) is distinct from 'array' then
    return false;
  end if;

  for authentication_method in
    select value
    from jsonb_array_elements(authentication_methods)
  loop
    if jsonb_typeof(authentication_method) = 'string' then
      method_name := authentication_method #>> '{}';
    elsif jsonb_typeof(authentication_method) = 'object'
      and jsonb_typeof(authentication_method -> 'method') = 'string'
      and jsonb_typeof(authentication_method -> 'timestamp') = 'number'
    then
      method_name := authentication_method ->> 'method';
    else
      return false;
    end if;

    if method_name is null
      or btrim(method_name) = ''
      or method_name is distinct from btrim(method_name)
    then
      return false;
    end if;

    if method_name = 'recovery' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.has_product_session() from public, anon;
grant execute on function public.has_product_session() to authenticated;

comment on function public.has_product_session() is
  'True only for a verified authenticated request whose structurally valid AMR does not contain recovery; missing AMR is accepted for legacy sessions.';

create or replace function public.has_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_product_session()
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.anonymized_at is null
    );
$$;

revoke all on function public.has_active_profile() from public, anon;
grant execute on function public.has_active_profile() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_product_session()
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.anonymized_at is null
        and profile.is_admin = true
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Keep 0027's ingest semantics, with an explicit product-session guard before
-- this SECURITY DEFINER function touches any product table.
create or replace function public.ingest_play_time_event(
  p_event_id uuid,
  p_week_id uuid,
  p_duration_seconds integer,
  p_mode text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_local_game_key text,
  p_rom_name text default null,
  p_client_version text default null
)
returns table (
  inserted boolean,
  duplicate boolean,
  game_total_seconds bigint,
  total_seconds bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid := auth.uid();
  v_game_id uuid;
  v_rows integer := 0;
  v_game_total bigint := 0;
  v_total bigint := 0;
begin
  if not public.has_product_session() then
    raise exception using errcode = '42501', message = 'product_session_required';
  end if;

  if not public.has_active_profile() then
    raise exception using errcode = '42501', message = 'active_profile_required';
  end if;

  if p_duration_seconds is null or p_duration_seconds < 1 or p_duration_seconds > 604800 then
    raise exception using errcode = '22023', message = 'invalid_duration';
  end if;

  if p_mode is null or p_mode not in ('practice', 'competition') then
    raise exception using errcode = '22023', message = 'invalid_mode';
  end if;

  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at then
    raise exception using errcode = '22023', message = 'invalid_time_range';
  end if;

  select week.game_id
  into v_game_id
  from public.weeks week
  where week.id = p_week_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'week_not_found';
  end if;

  if v_game_id is null then
    raise exception using errcode = 'P0002', message = 'week_game_not_assigned';
  end if;

  insert into public.play_time_events (
    player_id,
    event_id,
    game_id,
    week_id,
    duration_seconds,
    mode,
    started_at,
    ended_at,
    local_game_key,
    rom_name,
    client_version
  ) values (
    v_player_id,
    p_event_id,
    v_game_id,
    p_week_id,
    p_duration_seconds,
    p_mode,
    p_started_at,
    p_ended_at,
    trim(p_local_game_key),
    nullif(trim(p_rom_name), ''),
    nullif(trim(p_client_version), '')
  )
  on conflict (player_id, event_id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    insert into public.player_game_play_time (player_id, game_id, total_seconds, updated_at)
    values (v_player_id, v_game_id, p_duration_seconds, now())
    on conflict (player_id, game_id) do update
      set total_seconds = public.player_game_play_time.total_seconds + excluded.total_seconds,
          updated_at = now()
    returning public.player_game_play_time.total_seconds into v_game_total;

    insert into public.player_play_time_totals (player_id, total_seconds, updated_at)
    values (v_player_id, p_duration_seconds, now())
    on conflict (player_id) do update
      set total_seconds = public.player_play_time_totals.total_seconds + excluded.total_seconds,
          updated_at = now()
    returning public.player_play_time_totals.total_seconds into v_total;
  else
    select event.game_id
    into v_game_id
    from public.play_time_events event
    where event.player_id = v_player_id
      and event.event_id = p_event_id;

    select coalesce(game_total.total_seconds, 0)
    into v_game_total
    from public.player_game_play_time game_total
    where game_total.player_id = v_player_id
      and game_total.game_id = v_game_id;

    select coalesce(player_total.total_seconds, 0)
    into v_total
    from public.player_play_time_totals player_total
    where player_total.player_id = v_player_id;
  end if;

  return query
    select v_rows = 1, v_rows = 0, coalesce(v_game_total, 0), coalesce(v_total, 0);
end;
$$;

revoke all on function public.ingest_play_time_event(
  uuid, uuid, integer, text, timestamptz, timestamptz, text, text, text
) from public, anon;
grant execute on function public.ingest_play_time_event(
  uuid, uuid, integer, text, timestamptz, timestamptz, text, text, text
) to authenticated;

-- Trigger entry points never need direct client EXECUTE. Revoking it removes
-- accidental SECURITY DEFINER RPC surfaces without changing trigger execution.
do $revoke_security_definer_trigger_execute$
declare
  routine record;
begin
  for routine in
    select
      namespace.nspname as schema_name,
      proc.proname as routine_name,
      pg_get_function_identity_arguments(proc.oid) as identity_arguments
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.prosecdef
      and proc.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      routine.schema_name,
      routine.routine_name,
      routine.identity_arguments
    );
  end loop;
end
$revoke_security_definer_trigger_execute$;

-- Derive the product-data boundary from live privileges at migration time.
-- Service-role-only tables are excluded because authenticated has no DML grant.
do $add_product_session_table_barriers$
declare
  relation record;
begin
  for relation in
    select namespace.nspname as schema_name, class.relname as relation_name
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relkind in ('r', 'p')
      and class.relrowsecurity
      and (
        has_table_privilege('authenticated', class.oid, 'SELECT')
        or has_table_privilege('authenticated', class.oid, 'INSERT')
        or has_table_privilege('authenticated', class.oid, 'UPDATE')
        or has_table_privilege('authenticated', class.oid, 'DELETE')
      )
    order by class.relname
  loop
    execute format(
      'drop policy if exists hsl_product_session_barrier on %I.%I',
      relation.schema_name,
      relation.relation_name
    );
    execute format(
      'create policy hsl_product_session_barrier on %I.%I as restrictive for all to authenticated using ((select public.has_product_session())) with check ((select public.has_product_session()))',
      relation.schema_name,
      relation.relation_name
    );
  end loop;
end
$add_product_session_table_barriers$;

-- Public CDN downloads remain public. This only gates authenticated Data API
-- operations against the HSL-managed media bucket.
drop policy if exists hsl_product_session_barrier on storage.objects;
create policy hsl_product_session_barrier
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id is distinct from 'hsl-public-media'
  or (select public.has_product_session())
)
with check (
  bucket_id is distinct from 'hsl-public-media'
  or (select public.has_product_session())
);

comment on policy hsl_product_session_barrier on storage.objects is
  'Requires an HSL product session for authenticated operations in hsl-public-media; public CDN reads are unchanged.';

-- Fail the migration if a client-executable SECURITY DEFINER product RPC is
-- not transitively guarded by the canonical product-session authority.
do $verify_security_definer_product_guards$
declare
  unguarded_routines text[];
begin
  select array_agg(routine_signature order by routine_signature)
  into unguarded_routines
  from (
    select proc.oid::regprocedure::text as routine_signature
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.prosecdef
      and proc.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', proc.oid, 'EXECUTE')
      and pg_get_functiondef(proc.oid) !~
        'has_product_session|has_active_profile|is_admin'
  ) unguarded;

  if cardinality(unguarded_routines) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'unguarded_authenticated_security_definer_routines',
      detail = array_to_string(unguarded_routines, ', ');
  end if;
end
$verify_security_definer_product_guards$;

commit;
