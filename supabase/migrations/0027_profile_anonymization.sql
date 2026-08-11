-- PROFILE-ANONYMIZATION-1: irreversible tombstones with preserved league history.
-- Apply only after 0026_submission_detected_at_window.sql.

do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.submissions_player_duplicate_key_unique_idx') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      '0026 submissions_player_duplicate_key_unique_idx'
    );
  end if;

  if to_regclass('public.play_time_events') is null then
    missing_dependencies := array_append(missing_dependencies, '0025 play_time_events');
  end if;

  if to_regclass('public.player_game_play_time') is null then
    missing_dependencies := array_append(missing_dependencies, '0025 player_game_play_time');
  end if;

  if to_regclass('public.player_play_time_totals') is null then
    missing_dependencies := array_append(missing_dependencies, '0025 player_play_time_totals');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'play_time_public'
  ) then
    missing_dependencies := array_append(missing_dependencies, '0025 profiles.play_time_public');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'track_play_time'
  ) then
    missing_dependencies := array_append(missing_dependencies, '0010 profiles.track_play_time');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'avatar_storage_path'
  ) then
    missing_dependencies := array_append(missing_dependencies, '0024 profiles.avatar_storage_path');
  end if;

  if exists (
    select 1
    from unnest(
      array['raw_event', 'mame_version', 'client_version', 'duplicate_key', 'rom_name']
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns columns
      where columns.table_schema = 'public'
        and columns.table_name = 'submissions'
        and columns.column_name = required.column_name
    )
  ) then
    missing_dependencies := array_append(missing_dependencies, '0002 submission technical columns');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'profile_anonymization_missing_dependencies',
      detail = array_to_string(missing_dependencies, ', ');
  end if;
end $$;

alter table public.profiles
  add column if not exists anonymized_at timestamptz;

comment on column public.profiles.anonymized_at is
  'Null for an active account; set once for an irreversible anonymous historical actor.';

do $$
begin
  if exists (
    select 1
    from public.profiles
    where anonymized_at is null
      and lower(trim(username)) like 'deleted\_%' escape '\'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'profile_anonymization_deleted_namespace_conflict',
      detail = 'Resolve active usernames beginning with deleted_ before applying 0027.';
  end if;
end $$;

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  drop constraint if exists profiles_username_lifecycle_format;

alter table public.profiles
  add constraint profiles_username_lifecycle_format check (
    (
      anonymized_at is null
      and username ~ '^[a-z][a-z0-9_]{2,19}$'
      and lower(username) !~ '^deleted_'
    )
    or (
      anonymized_at is not null
      and username ~ '^deleted_[0-9a-f]{24}$'
    )
  );

drop index if exists public.profiles_initials_upper_unique_idx;

create unique index profiles_initials_upper_unique_idx
on public.profiles (upper(trim(initials)))
where anonymized_at is null;

create table if not exists public.retired_profile_usernames (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  username_fingerprint text not null unique,
  retired_at timestamptz not null default now(),
  constraint retired_profile_usernames_fingerprint_format check (
    username_fingerprint ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.retired_profile_usernames is
  'Private normalized fingerprints used only to prevent takeover of retired profile URLs.';

alter table public.retired_profile_usernames enable row level security;
revoke all on table public.retired_profile_usernames from public, anon, authenticated;
grant select on table public.retired_profile_usernames to service_role;

create or replace function public.profile_username_fingerprint(value text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(lower(trim(value)), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public.profile_username_fingerprint(text) from public, anon, authenticated;
grant execute on function public.profile_username_fingerprint(text) to service_role;

create or replace function public.enforce_profile_identity_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.anonymized_at is not null then
    raise exception using errcode = '42501', message = 'profile_anonymized_insert_forbidden';
  end if;

  if tg_op = 'UPDATE' and old.anonymized_at is not null then
    if new.anonymized_at is distinct from old.anonymized_at
      or new.username is distinct from old.username
      or new.initials is distinct from old.initials
      or new.avatar_url is distinct from old.avatar_url
      or new.avatar_storage_path is distinct from old.avatar_storage_path
      or new.bio is distinct from old.bio
      or new.is_admin is distinct from old.is_admin
      or new.play_time_public is distinct from old.play_time_public
      or new.track_play_time is distinct from old.track_play_time
    then
      raise exception using errcode = '42501', message = 'profile_anonymized';
    end if;

    return new;
  end if;

  if new.anonymized_at is null then
    if lower(trim(new.username)) like 'deleted\_%' escape '\' then
      raise exception using errcode = '23514', message = 'username_reserved';
    end if;

    if exists (
      select 1
      from public.retired_profile_usernames retired
      where retired.username_fingerprint = public.profile_username_fingerprint(new.username)
    ) then
      raise exception using errcode = 'P0001', message = 'username_retired';
    end if;

    return new;
  end if;

  if tg_op <> 'UPDATE'
    or old.anonymized_at is not null
    or auth.role() is distinct from 'service_role'
  then
    raise exception using errcode = '42501', message = 'profile_anonymization_service_role_required';
  end if;

  if new.username !~ '^deleted_[0-9a-f]{24}$'
    or new.initials <> 'DEL'
    or new.avatar_url is not null
    or new.avatar_storage_path is not null
    or new.bio is not null
    or new.is_admin
    or new.play_time_public
    or new.track_play_time
  then
    raise exception using errcode = '23514', message = 'profile_anonymization_incomplete';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_identity_lifecycle() from public, anon, authenticated;

drop trigger if exists profiles_enforce_identity_lifecycle on public.profiles;
create trigger profiles_enforce_identity_lifecycle
before insert or update on public.profiles
for each row execute function public.enforce_profile_identity_lifecycle();

create or replace function public.has_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.anonymized_at is null
      and profile.is_admin = true
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.anonymize_profile_account(p_profile_id uuid)
returns table (
  profile_id uuid,
  anonymous_alias text,
  profile_anonymized_at timestamptz,
  already_anonymized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile public.profiles%rowtype;
  old_username text;
  generated_alias text;
  deleted_at timestamptz;
  active_admin_count integer;
  attempt integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  perform pg_advisory_xact_lock(hashtext('profile_anonymization_admin_guard'));

  select profile.*
  into current_profile
  from public.profiles profile
  where profile.id = p_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  if current_profile.anonymized_at is not null then
    return query
      select
        current_profile.id,
        current_profile.username,
        current_profile.anonymized_at,
        true;
    return;
  end if;

  if current_profile.is_admin then
    select count(*)::integer
    into active_admin_count
    from public.profiles profile
    where profile.is_admin = true
      and profile.anonymized_at is null;

    if active_admin_count <= 1 then
      raise exception using errcode = 'P0001', message = 'last_admin';
    end if;
  end if;

  old_username := current_profile.username;
  deleted_at := clock_timestamp();

  insert into public.retired_profile_usernames (
    profile_id,
    username_fingerprint,
    retired_at
  ) values (
    current_profile.id,
    public.profile_username_fingerprint(old_username),
    deleted_at
  )
  on conflict (profile_id) do nothing;

  for attempt in 1..32 loop
    generated_alias := 'deleted_' || encode(extensions.gen_random_bytes(12), 'hex');

    begin
      update public.profiles
      set
        username = generated_alias,
        initials = 'DEL',
        avatar_url = null,
        avatar_storage_path = null,
        bio = null,
        is_admin = false,
        play_time_public = false,
        track_play_time = false,
        anonymized_at = deleted_at
      where id = current_profile.id;

      exit;
    exception
      when unique_violation then
        generated_alias := null;
    end;
  end loop;

  if generated_alias is null then
    raise exception using errcode = 'P0001', message = 'anonymous_alias_generation_failed';
  end if;

  update public.submissions
  set
    raw_event = null,
    mame_version = null,
    client_version = null,
    duplicate_key = null
  where player_id = current_profile.id;

  update public.season_memberships membership
  set status = 'left'
  from public.seasons season
  where membership.player_id = current_profile.id
    and membership.status = 'active'
    and season.id = membership.season_id
    and season.status = 'active';

  delete from public.play_time_events
  where player_id = current_profile.id;

  delete from public.player_game_play_time
  where player_id = current_profile.id;

  delete from public.player_play_time_totals
  where player_id = current_profile.id;

  update public.league_chat_messages
  set content = generated_alias || ' se unió al chat.'
  where message_type = 'system'
    and author_id is null
    and content = old_username || ' se unió al chat.';

  return query
    select current_profile.id, generated_alias, deleted_at, false;
end;
$$;

comment on function public.anonymize_profile_account(uuid) is
  'Service-role-only transactional DB barrier for irreversible profile anonymization. Preserves competitive and free-text history.';

revoke all on function public.anonymize_profile_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_profile_account(uuid) to service_role;

-- A security-definer read must also reject an access JWT owned by a tombstone.
drop function if exists public.get_week_hidden_submission_activity(uuid);

create function public.get_week_hidden_submission_activity(p_week_id uuid)
returns table (
  id uuid,
  week_id uuid,
  player_id uuid,
  submitted_at timestamptz,
  is_hidden boolean,
  is_valid boolean,
  source text,
  detected_at timestamptz,
  profile_id uuid,
  profile_username text,
  profile_initials text,
  profile_avatar_url text,
  profile_anonymized_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    submission.id,
    submission.week_id,
    submission.player_id,
    submission.submitted_at,
    submission.is_hidden,
    submission.is_valid,
    submission.source,
    submission.detected_at,
    profile.id,
    profile.username,
    profile.initials,
    profile.avatar_url,
    profile.anonymized_at
  from public.submissions submission
  join public.weeks week on week.id = submission.week_id
  join public.profiles profile on profile.id = submission.player_id
  where public.has_active_profile()
    and submission.week_id = p_week_id
    and submission.is_hidden = true
    and submission.is_valid = true
    and (
      week.status = 'frozen'
      or (
        week.status not in ('draft', 'closed', 'published')
        and week.public_freeze_at is not null
        and now() >= week.public_freeze_at
        and (week.final_deadline_at is null or now() < week.final_deadline_at)
      )
    )
  order by submission.submitted_at desc, submission.id desc;
$$;

revoke all on function public.get_week_hidden_submission_activity(uuid) from public, anon;
grant execute on function public.get_week_hidden_submission_activity(uuid) to authenticated;

create or replace function public.is_latest_own_league_chat_message(
  message_id uuid,
  message_created_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.has_active_profile()
    and not exists (
      select 1
      from public.league_chat_messages newer
      where newer.message_type = 'user'
        and newer.author_id = auth.uid()
        and (
          newer.created_at > message_created_at
          or (newer.created_at = message_created_at and newer.id > message_id)
        )
    );
$$;

revoke all on function public.is_latest_own_league_chat_message(uuid, timestamptz)
from public, anon;
grant execute on function public.is_latest_own_league_chat_message(uuid, timestamptz)
to authenticated;

-- Replaces the 0025 implementation only to strengthen profile existence into
-- active-profile existence. Event and aggregate semantics stay unchanged.
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

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_player_id
      and profile.anonymized_at is null
  ) then
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

-- Active-viewer read barriers. Historical rows remain visible; the viewer,
-- rather than the historical actor, is the subject of has_active_profile().
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles for select to authenticated
using (public.has_active_profile());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert to authenticated
with check (
  id = auth.uid()
  and auth.uid() is not null
  and anonymized_at is null
  and is_admin = false
  and lower(username) !~ '^deleted_'
);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update to authenticated
using (
  id = auth.uid()
  and anonymized_at is null
  and public.has_active_profile()
)
with check (
  id = auth.uid()
  and anonymized_at is null
  and is_admin = false
  and lower(username) !~ '^deleted_'
);

drop policy if exists seasons_select_authenticated on public.seasons;
create policy seasons_select_authenticated
on public.seasons for select to authenticated
using (public.has_active_profile());

drop policy if exists games_select_authenticated on public.games;
create policy games_select_authenticated
on public.games for select to authenticated
using (public.has_active_profile());

drop policy if exists weeks_select_authenticated on public.weeks;
create policy weeks_select_authenticated
on public.weeks for select to authenticated
using (public.has_active_profile());

drop policy if exists week_benchmarks_select_active_authenticated on public.week_benchmarks;
create policy week_benchmarks_select_active_authenticated
on public.week_benchmarks for select to authenticated
using (is_active = true and public.has_active_profile());

drop policy if exists submissions_select_visible on public.submissions;
create policy submissions_select_visible
on public.submissions for select to authenticated
using (
  public.has_active_profile()
  and is_hidden = false
  and is_valid = true
);

drop policy if exists submissions_select_own on public.submissions;
create policy submissions_select_own
on public.submissions for select to authenticated
using (public.has_active_profile() and player_id = auth.uid());

drop policy if exists submissions_insert_own on public.submissions;
create policy submissions_insert_own
on public.submissions for insert to authenticated
with check (
  public.has_active_profile()
  and player_id = auth.uid()
  and is_valid = true
  and detected_at is not null
  and exists (
    select 1
    from public.weeks week
    join public.season_memberships membership
      on membership.season_id = week.season_id
     and membership.player_id = auth.uid()
     and membership.status = 'active'
    where week.id = week_id
      and week.public_start_at is not null
      and week.final_deadline_at is not null
      and detected_at >= week.public_start_at
      and detected_at < week.final_deadline_at
      and (
        week.public_freeze_at is null
        or detected_at < week.public_freeze_at
        or is_hidden = true
      )
  )
);

drop policy if exists weekly_results_select_authenticated on public.weekly_results;
create policy weekly_results_select_authenticated
on public.weekly_results for select to authenticated
using (public.has_active_profile());

-- Some deployed environments predate or deliberately omit the unused legacy
-- chat table. Preserve and protect it when present, but do not make it a
-- dependency of profile anonymization.
do $legacy_chat_policies$
begin
  if to_regclass('public.chat_messages') is not null then
    execute 'drop policy if exists chat_messages_select_visible on public.chat_messages';
    execute $policy$
      create policy chat_messages_select_visible
      on public.chat_messages for select to authenticated
      using (public.has_active_profile() and is_deleted = false)
    $policy$;

    execute 'drop policy if exists chat_messages_insert_own on public.chat_messages';
    execute $policy$
      create policy chat_messages_insert_own
      on public.chat_messages for insert to authenticated
      with check (
        public.has_active_profile()
        and player_id = auth.uid()
        and is_deleted = false
        and length(trim(body)) > 0
        and char_length(body) <= 500
      )
    $policy$;
  else
    raise notice 'Optional legacy relation public.chat_messages is absent; policies skipped.';
  end if;
end
$legacy_chat_policies$;

drop policy if exists season_memberships_select_authenticated on public.season_memberships;
create policy season_memberships_select_authenticated
on public.season_memberships for select to authenticated
using (public.has_active_profile());

drop policy if exists season_memberships_insert_own_active_season on public.season_memberships;
create policy season_memberships_insert_own_active_season
on public.season_memberships for insert to authenticated
with check (
  public.has_active_profile()
  and player_id = auth.uid()
  and status = 'active'
  and exists (
    select 1
    from public.seasons season
    where season.id = season_id
      and season.status = 'active'
  )
);

drop policy if exists league_chat_messages_select_authenticated on public.league_chat_messages;
create policy league_chat_messages_select_authenticated
on public.league_chat_messages for select to authenticated
using (public.has_active_profile());

drop policy if exists league_chat_messages_insert_user_own on public.league_chat_messages;
create policy league_chat_messages_insert_user_own
on public.league_chat_messages for insert to authenticated
with check (
  public.has_active_profile()
  and message_type = 'user'
  and author_id = auth.uid()
  and length(trim(content)) > 0
  and char_length(content) <= 65536
);

drop policy if exists league_chat_messages_update_user_own_recent on public.league_chat_messages;
create policy league_chat_messages_update_user_own_recent
on public.league_chat_messages for update to authenticated
using (
  public.has_active_profile()
  and message_type = 'user'
  and author_id = auth.uid()
  and created_at >= now() - interval '15 minutes'
  and public.is_latest_own_league_chat_message(id, created_at)
)
with check (
  public.has_active_profile()
  and message_type = 'user'
  and author_id = auth.uid()
  and created_at >= now() - interval '15 minutes'
  and length(trim(content)) > 0
  and char_length(content) <= 65536
  and public.is_latest_own_league_chat_message(id, created_at)
);

drop policy if exists home_polls_select_active on public.home_polls;
create policy home_polls_select_active
on public.home_polls for select to authenticated
using (
  public.has_active_profile()
  and enabled = true
  and length(trim(question)) > 0
  and (closes_at is null or closes_at > now())
);

drop policy if exists home_poll_options_select_active_poll on public.home_poll_options;
create policy home_poll_options_select_active_poll
on public.home_poll_options for select to authenticated
using (
  public.has_active_profile()
  and exists (
    select 1
    from public.home_polls poll
    where poll.id = poll_id
      and poll.enabled = true
      and length(trim(poll.question)) > 0
      and (poll.closes_at is null or poll.closes_at > now())
  )
);

drop policy if exists home_poll_votes_select_own on public.home_poll_votes;
create policy home_poll_votes_select_own
on public.home_poll_votes for select to authenticated
using (public.has_active_profile() and player_id = auth.uid());

drop policy if exists home_poll_votes_insert_own_active_poll on public.home_poll_votes;
create policy home_poll_votes_insert_own_active_poll
on public.home_poll_votes for insert to authenticated
with check (
  public.has_active_profile()
  and player_id = auth.uid()
  and exists (
    select 1
    from public.home_polls poll
    where poll.id = poll_id
      and poll.enabled = true
      and length(trim(poll.question)) > 0
      and (poll.closes_at is null or poll.closes_at > now())
  )
  and exists (
    select 1
    from public.home_poll_options option
    where option.id = option_id
      and option.poll_id = home_poll_votes.poll_id
  )
);

drop policy if exists home_poll_votes_update_own_active_poll on public.home_poll_votes;
create policy home_poll_votes_update_own_active_poll
on public.home_poll_votes for update to authenticated
using (public.has_active_profile() and player_id = auth.uid())
with check (
  public.has_active_profile()
  and player_id = auth.uid()
  and exists (
    select 1
    from public.home_polls poll
    where poll.id = poll_id
      and poll.enabled = true
      and length(trim(poll.question)) > 0
      and (poll.closes_at is null or poll.closes_at > now())
  )
  and exists (
    select 1
    from public.home_poll_options option
    where option.id = option_id
      and option.poll_id = home_poll_votes.poll_id
  )
);

drop policy if exists play_time_events_admin_select on public.play_time_events;
create policy play_time_events_admin_select
on public.play_time_events for select to authenticated
using (public.has_active_profile() and public.is_admin());

drop policy if exists player_game_play_time_select_visible on public.player_game_play_time;
create policy player_game_play_time_select_visible
on public.player_game_play_time for select to authenticated
using (
  public.has_active_profile()
  and (
    player_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = player_id
        and profile.anonymized_at is null
        and profile.play_time_public = true
    )
  )
);

drop policy if exists player_play_time_totals_select_visible on public.player_play_time_totals;
create policy player_play_time_totals_select_visible
on public.player_play_time_totals for select to authenticated
using (
  public.has_active_profile()
  and (
    player_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = player_id
        and profile.anonymized_at is null
        and profile.play_time_public = true
    )
  )
);

drop policy if exists hsl_public_media_avatar_insert_own on storage.objects;
create policy hsl_public_media_avatar_insert_own
on storage.objects for insert to authenticated
with check (
  public.has_active_profile()
  and bucket_id = 'hsl-public-media'
  and name ~ (
    '^avatars/' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

drop policy if exists hsl_public_media_avatar_select_own on storage.objects;
create policy hsl_public_media_avatar_select_own
on storage.objects for select to authenticated
using (
  public.has_active_profile()
  and bucket_id = 'hsl-public-media'
  and name ~ (
    '^avatars/' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

drop policy if exists hsl_public_media_avatar_delete_own on storage.objects;
create policy hsl_public_media_avatar_delete_own
on storage.objects for delete to authenticated
using (
  public.has_active_profile()
  and bucket_id = 'hsl-public-media'
  and name ~ (
    '^avatars/' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);
