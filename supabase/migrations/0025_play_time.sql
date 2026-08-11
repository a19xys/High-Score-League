-- PLAYTIME-1: private-by-default visibility, idempotent ledger and aggregates.

alter table public.profiles
  add column if not exists play_time_public boolean not null default false;

comment on column public.profiles.play_time_public is
  'Controls whether other authenticated players may read Playtime totals. Owners always retain access.';

comment on column public.profiles.track_play_time is
  'Legacy/deprecated collection preference. PLAYTIME-1 records identified launcher sessions independently of this value.';

create table public.play_time_events (
  player_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  game_id uuid not null references public.games(id) on delete restrict,
  week_id uuid not null references public.weeks(id) on delete restrict,
  duration_seconds integer not null,
  mode text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  local_game_key text not null,
  rom_name text,
  client_version text,
  received_at timestamptz not null default now(),
  primary key (player_id, event_id),
  constraint play_time_events_duration_check check (duration_seconds between 1 and 604800),
  constraint play_time_events_mode_check check (mode in ('practice', 'competition')),
  constraint play_time_events_time_order_check check (ended_at >= started_at),
  constraint play_time_events_game_key_check check (
    length(trim(local_game_key)) between 1 and 128
  ),
  constraint play_time_events_rom_check check (
    rom_name is null or length(trim(rom_name)) between 1 and 128
  ),
  constraint play_time_events_client_version_check check (
    client_version is null or length(trim(client_version)) between 1 and 64
  )
);

create index play_time_events_player_received_idx
on public.play_time_events (player_id, received_at desc);

create index play_time_events_game_player_idx
on public.play_time_events (game_id, player_id);

create table public.player_game_play_time (
  player_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  total_seconds bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id),
  constraint player_game_play_time_total_check check (total_seconds >= 0)
);

create table public.player_play_time_totals (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  total_seconds bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint player_play_time_totals_total_check check (total_seconds >= 0)
);

alter table public.play_time_events enable row level security;
alter table public.player_game_play_time enable row level security;
alter table public.player_play_time_totals enable row level security;

create policy play_time_events_admin_select
on public.play_time_events
for select
to authenticated
using (public.is_admin());

create policy player_game_play_time_select_visible
on public.player_game_play_time
for select
to authenticated
using (
  player_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1
    from public.profiles profile
    where profile.id = player_id
      and profile.play_time_public = true
  )
);

create policy player_play_time_totals_select_visible
on public.player_play_time_totals
for select
to authenticated
using (
  player_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1
    from public.profiles profile
    where profile.id = player_id
      and profile.play_time_public = true
  )
);

revoke all on public.play_time_events from anon, authenticated;
revoke all on public.player_game_play_time from anon, authenticated;
revoke all on public.player_play_time_totals from anon, authenticated;
grant select on public.play_time_events to authenticated;
grant select on public.player_game_play_time to authenticated;
grant select on public.player_play_time_totals to authenticated;

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
  if v_player_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = v_player_id) then
    raise exception using errcode = '42501', message = 'profile_required';
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

  return query select v_rows = 1, v_rows = 0, coalesce(v_game_total, 0), coalesce(v_total, 0);
end;
$$;

revoke all on function public.ingest_play_time_event(
  uuid, uuid, integer, text, timestamptz, timestamptz, text, text, text
) from public, anon;

grant execute on function public.ingest_play_time_event(
  uuid, uuid, integer, text, timestamptz, timestamptz, text, text, text
) to authenticated;

comment on function public.ingest_play_time_event(
  uuid, uuid, integer, text, timestamptz, timestamptz, text, text, text
) is 'Idempotently ingests one authenticated launcher Playtime event and updates both aggregates in one transaction.';
