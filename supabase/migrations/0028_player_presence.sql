-- PROFILE-PRESENCE-1: ephemeral, opt-in web/launcher presence.

alter table public.profiles
  add column if not exists presence_public boolean not null default false;

comment on column public.profiles.presence_public is
  'Opt-in visibility for ephemeral current Presence. Independent from Playtime preferences.';

create table public.player_presence_sessions (
  player_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null,
  source text not null,
  activity text not null,
  game_id uuid references public.games(id) on delete set null,
  week_id uuid references public.weeks(id) on delete set null,
  mode text,
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key (player_id, source, client_id),
  constraint player_presence_source_check check (source in ('web', 'launcher')),
  constraint player_presence_activity_check check (activity in ('connected', 'playing')),
  constraint player_presence_mode_check check (mode is null or mode in ('practice', 'competition')),
  constraint player_presence_context_check check (
    (activity = 'connected' and game_id is null and week_id is null and mode is null)
    or (activity = 'playing' and source = 'launcher' and mode is not null)
  )
);

create index player_presence_sessions_live_idx
on public.player_presence_sessions (player_id, last_seen_at desc);

alter table public.player_presence_sessions enable row level security;
revoke all on table public.player_presence_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.player_presence_sessions to service_role;

create or replace function public.enforce_profile_presence_privacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anonymized_at is not null then
    new.presence_public := false;
  end if;

  if (old.presence_public and not new.presence_public)
    or (old.anonymized_at is null and new.anonymized_at is not null)
  then
    delete from public.player_presence_sessions where player_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_presence_privacy() from public, anon, authenticated;
drop trigger if exists profiles_presence_privacy_barrier on public.profiles;
create trigger profiles_presence_privacy_barrier
before update of presence_public, anonymized_at on public.profiles
for each row execute function public.enforce_profile_presence_privacy();

create or replace function public.commit_player_presence(
  p_player_id uuid,
  p_client_id uuid,
  p_source text,
  p_activity text,
  p_week_id uuid default null,
  p_mode text default null
)
returns table (private boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_week_id uuid := null;
  v_game_id uuid := null;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_player_id is null or p_client_id is null
    or p_source is null or p_source not in ('web', 'launcher')
    or p_activity is null or p_activity not in ('connected', 'playing')
    or (p_source = 'web' and p_activity <> 'connected')
    or (p_activity = 'connected' and (p_week_id is not null or p_mode is not null))
    or (p_activity = 'playing' and (p_mode is null or p_mode not in ('practice', 'competition')))
  then
    raise exception using errcode = '22023', message = 'invalid_presence';
  end if;

  select profile.* into v_profile
  from public.profiles profile
  where profile.id = p_player_id
  for update;

  if not found or v_profile.anonymized_at is not null then
    raise exception using errcode = '42501', message = 'active_profile_required';
  end if;

  if not v_profile.presence_public then
    delete from public.player_presence_sessions where player_id = p_player_id;
    return query select true;
    return;
  end if;

  if p_activity = 'playing' and p_week_id is not null then
    select week.id, week.game_id into v_week_id, v_game_id
    from public.weeks week
    where week.id = p_week_id;
  end if;

  delete from public.player_presence_sessions
  where player_id = p_player_id
    and last_seen_at < clock_timestamp() - interval '24 hours';

  insert into public.player_presence_sessions (
    player_id, client_id, source, activity, game_id, week_id, mode, created_at, last_seen_at
  ) values (
    p_player_id,
    p_client_id,
    p_source,
    p_activity,
    case when p_activity = 'playing' then v_game_id else null end,
    case when p_activity = 'playing' then v_week_id else null end,
    case when p_activity = 'playing' then p_mode else null end,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (player_id, source, client_id) do update set
    activity = excluded.activity,
    game_id = excluded.game_id,
    week_id = excluded.week_id,
    mode = excluded.mode,
    last_seen_at = clock_timestamp();

  return query select false;
end;
$$;

revoke all on function public.commit_player_presence(uuid, uuid, text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.commit_player_presence(uuid, uuid, text, text, uuid, text)
to service_role;

create or replace function public.clear_player_presence(
  p_player_id uuid,
  p_client_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  delete from public.player_presence_sessions
  where player_id = p_player_id and client_id = p_client_id and source = p_source;
end;
$$;

revoke all on function public.clear_player_presence(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.clear_player_presence(uuid, uuid, text)
to service_role;

comment on table public.player_presence_sessions is
  'Ephemeral now-only Presence heartbeats. No history, last-seen product feature, network or device metadata.';
