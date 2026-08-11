-- PROFILE-ANONYMIZATION-1 / 0027 preflight (read-only).
-- Run in Supabase SQL Editor before applying 0027_profile_anonymization.sql.
-- Every statement in this file is SELECT-only: it does not alter schema or data.

-- 1. Migration history. 0026 must already be present. 0027 must not be present
--    until the new migration is deliberately applied.
select version, name
from supabase_migrations.schema_migrations
where version in ('0025', '0026', '0027')
order by version;

-- 2. Required tables introduced by the normal local sequence through 0026.
select dependency, relation_name, to_regclass(relation_name) is not null as present
from (
  values
    ('profile identity', 'public.profiles'),
    ('submission history', 'public.submissions'),
    ('official results', 'public.weekly_results'),
    ('season memberships', 'public.season_memberships'),
    ('league chat', 'public.league_chat_messages'),
    ('legacy chat', 'public.chat_messages'),
    ('home poll votes', 'public.home_poll_votes'),
    ('Playtime event ledger (0025)', 'public.play_time_events'),
    ('Playtime per-game aggregate (0025)', 'public.player_game_play_time'),
    ('Playtime total aggregate (0025)', 'public.player_play_time_totals')
) as required(dependency, relation_name)
order by relation_name;

-- 3. Required columns. Every row must return present = true.
with required(table_name, column_name, introduced_by) as (
  values
    ('profiles', 'username', '0001'),
    ('profiles', 'initials', '0001'),
    ('profiles', 'avatar_url', '0001'),
    ('profiles', 'avatar_storage_path', '0024'),
    ('profiles', 'bio', '0023'),
    ('profiles', 'is_admin', '0001'),
    ('profiles', 'play_time_public', '0025'),
    ('submissions', 'raw_event', '0002'),
    ('submissions', 'rom_name', '0002'),
    ('submissions', 'mame_version', '0002'),
    ('submissions', 'client_version', '0002'),
    ('submissions', 'duplicate_key', '0002'),
    ('league_chat_messages', 'author_id', '0006'),
    ('league_chat_messages', 'message_type', '0006'),
    ('league_chat_messages', 'content', '0006'),
    ('season_memberships', 'status', '0003')
)
select
  required.table_name,
  required.column_name,
  required.introduced_by,
  columns.column_name is not null as present
from required
left join information_schema.columns as columns
  on columns.table_schema = 'public'
 and columns.table_name = required.table_name
 and columns.column_name = required.column_name
order by required.table_name, required.column_name;

-- 4. Constraints/indexes consumed or replaced by 0027. Inspect unexpected
--    definitions before applying the migration.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and (
    (tablename = 'profiles' and indexname in ('profiles_username_key', 'profiles_initials_upper_unique_idx'))
    or (tablename = 'submissions' and indexname = 'submissions_player_duplicate_key_unique')
  )
order by tablename, indexname;

select
  pg_constraint.conname as constraint_name,
  pg_get_constraintdef(pg_constraint.oid) as definition
from pg_constraint
join pg_namespace on pg_namespace.oid = pg_constraint.connamespace
where pg_namespace.nspname = 'public'
  and pg_constraint.conrelid = 'public.profiles'::regclass
  and pg_constraint.conname in ('profiles_username_format', 'profiles_bio_max_length');

-- 5. Namespace collision. This must return zero rows before 0027.
select id, username
from public.profiles
where lower(username) like 'deleted\_%' escape '\';

-- 6. Administrative guardrail. Record the count before applying 0027; the
--    migration and RPC refuse to anonymize the final active administrator.
select
  count(*) as total_profiles,
  count(*) filter (where is_admin) as administrator_profiles
from public.profiles;

-- 7. Avatar inventory. Managed avatars must remain under avatars/<uid>/.
--    unexpected_avatar_paths must be zero for paths stored by this application.
select
  count(*) filter (where avatar_storage_path is not null) as profiles_with_managed_avatar,
  count(*) filter (
    where avatar_storage_path is not null
      and avatar_storage_path <> 'avatars/' || id::text
      and avatar_storage_path not like 'avatars/' || id::text || '/%'
  ) as unexpected_avatar_paths
from public.profiles;

select
  count(*) as stored_avatar_objects,
  count(*) filter (where name !~ '^avatars/[0-9a-f-]{36}/') as unexpected_avatar_objects
from storage.objects
where bucket_id = 'hsl-public-media'
  and name like 'avatars/%';

-- 8. Identity graph volume. These are inventory counts only; 0027 preserves
--    the historical rows except for deleting the three Playtime datasets.
select
  (select count(*) from public.submissions) as submissions,
  (select count(*) from public.weekly_results) as weekly_results,
  (select count(*) from public.season_memberships) as season_memberships,
  (select count(*) from public.league_chat_messages where author_id is not null) as authored_league_chat_messages,
  (select count(*) from public.chat_messages where player_id is not null) as authored_legacy_chat_messages,
  (select count(*) from public.home_poll_votes) as home_poll_votes,
  (select count(*) from public.play_time_events) as play_time_events,
  (select count(*) from public.player_game_play_time) as player_game_play_time_rows,
  (select count(*) from public.player_play_time_totals) as player_play_time_total_rows;

-- 9. Functions that 0027 replaces with active-profile-aware definitions.
select
  to_regprocedure('public.get_week_hidden_submission_activity(uuid)') as hidden_submission_activity,
  to_regprocedure('public.is_latest_own_league_chat_message(uuid,uuid)') as latest_chat_guard,
  to_regprocedure('public.ingest_play_time_event(uuid,uuid,integer,text,timestamptz,timestamptz,text,text,text)') as playtime_ingest;
