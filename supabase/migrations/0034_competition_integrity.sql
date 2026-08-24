-- Server-side authority for Protected Competition submissions.
-- 0033 was historically retired; 0034 is deliberate so that migration identity is never reused.

alter table public.launcher_packs
  add column competition_manifest_sha256 text;

alter table public.launcher_packs
  add constraint launcher_packs_competition_manifest_sha256_check
    check (
      competition_manifest_sha256 is null
      or competition_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint launcher_packs_pack_week_unique
    unique (pack_id, week_id);

comment on column public.launcher_packs.competition_manifest_sha256 is
  'Canonical SHA-256 of competition-manifest.json. Nullable only for legacy or not-yet-protected revisions.';

create or replace function public.compute_week_competition_policy_fingerprint(
  p_policy_version smallint,
  p_mode text,
  p_week_id uuid,
  p_launcher_pack_id text,
  p_evidence_version smallint,
  p_guard_version smallint,
  p_rom_name text,
  p_mame_version text,
  p_plugin_version text,
  p_source text,
  p_dips jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      jsonb_build_object(
        'policy_version', p_policy_version,
        'mode', p_mode,
        'week_id', p_week_id,
        'launcher_pack_id', p_launcher_pack_id,
        'evidence_version', p_evidence_version,
        'guard_version', p_guard_version,
        'rom_name', p_rom_name,
        'mame_version', p_mame_version,
        'plugin_version', p_plugin_version,
        'source', p_source,
        'dips', p_dips
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

comment on function public.compute_week_competition_policy_fingerprint(
  smallint, text, uuid, text, smallint, smallint, text, text, text, text, jsonb
) is
  'Deterministic DB-owned identity of every canonical competition policy field; excludes timestamps.';

create table public.week_competition_policies (
  week_id uuid primary key references public.weeks(id) on delete restrict,
  policy_version smallint not null default 1,
  mode text not null default 'protected_v2',
  launcher_pack_id text not null,
  evidence_version smallint not null default 2,
  guard_version smallint not null default 2,
  rom_name text not null,
  mame_version text not null,
  plugin_version text not null,
  source text not null default 'mame_memory',
  dips jsonb not null default '[]'::jsonb,
  policy_fingerprint text not null,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint week_competition_policies_policy_version_check check (policy_version = 1),
  constraint week_competition_policies_mode_check check (mode = 'protected_v2'),
  constraint week_competition_policies_evidence_version_check check (evidence_version = 2),
  constraint week_competition_policies_guard_version_check check (guard_version = 2),
  constraint week_competition_policies_source_check check (source = 'mame_memory'),
  constraint week_competition_policies_rom_name_check
    check (char_length(rom_name) between 1 and 64 and rom_name !~ '[[:cntrl:]]'),
  constraint week_competition_policies_mame_version_check
    check (char_length(mame_version) between 1 and 32 and mame_version !~ '[[:cntrl:]]'),
  constraint week_competition_policies_plugin_version_check
    check (char_length(plugin_version) between 1 and 32 and plugin_version !~ '[[:cntrl:]]'),
  constraint week_competition_policies_dips_check
    check (jsonb_typeof(dips) = 'array' and jsonb_array_length(dips) <= 32),
  constraint week_competition_policies_policy_fingerprint_check
    check (policy_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint week_competition_policies_pack_week_fk
    foreign key (launcher_pack_id, week_id)
    references public.launcher_packs(pack_id, week_id)
    on delete restrict
);

comment on table public.week_competition_policies is
  'Private canonical technical policy for a Protected Competition week. Absence means legacy.';
comment on column public.week_competition_policies.dips is
  'Canonical ordered [{portTag,mask,value}] contract; strict semantic validation is performed server-side.';
comment on column public.week_competition_policies.policy_fingerprint is
  'DB-owned SHA-256 of the complete canonical policy contract; excludes lifecycle timestamps.';
comment on column public.week_competition_policies.frozen_at is
  'Monotonic marker set atomically by the first accepted Protected submission, or earlier by an operator.';

create or replace function public.guard_week_competition_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  canonical_manifest text;
  target_pack_status text;
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null then
      raise exception 'frozen competition policy cannot be deleted'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.frozen_at is not null then
    if new.week_id is distinct from old.week_id
        or new.launcher_pack_id is distinct from old.launcher_pack_id
        or new.policy_version is distinct from old.policy_version
        or new.mode is distinct from old.mode
        or new.evidence_version is distinct from old.evidence_version
        or new.guard_version is distinct from old.guard_version
        or new.rom_name is distinct from old.rom_name
        or new.mame_version is distinct from old.mame_version
        or new.plugin_version is distinct from old.plugin_version
        or new.source is distinct from old.source
        or new.dips is distinct from old.dips
        or new.frozen_at is distinct from old.frozen_at then
      raise exception 'frozen competition policy is immutable'
        using errcode = '23514';
    end if;
  end if;

  select pack.competition_manifest_sha256, pack.status
  into canonical_manifest, target_pack_status
  from public.launcher_packs pack
  where pack.pack_id = new.launcher_pack_id
    and pack.week_id = new.week_id
  for update;

  if not found or canonical_manifest is null
      or canonical_manifest !~ '^[0-9a-f]{64}$' then
    raise exception 'protected policy requires a canonical pack manifest for the same week'
      using errcode = '23514';
  end if;

  if target_pack_status = 'disabled' then
    if tg_op = 'INSERT' then
      raise exception 'new or retargeted competition policy cannot use a disabled pack'
        using errcode = '23514';
    elsif new.launcher_pack_id is distinct from old.launcher_pack_id
        or old.frozen_at is null then
      raise exception 'new or retargeted competition policy cannot use a disabled pack'
        using errcode = '23514';
    end if;
  end if;

  new.policy_fingerprint := public.compute_week_competition_policy_fingerprint(
    new.policy_version,
    new.mode,
    new.week_id,
    new.launcher_pack_id,
    new.evidence_version,
    new.guard_version,
    new.rom_name,
    new.mame_version,
    new.plugin_version,
    new.source,
    new.dips
  );

  return new;
end;
$$;

create trigger week_competition_policies_guard
before insert or update or delete on public.week_competition_policies
for each row execute function public.guard_week_competition_policy();

create trigger week_competition_policies_set_updated_at
before update on public.week_competition_policies
for each row execute function public.set_updated_at();

-- A draft may still be corrected, but manifest identity becomes immutable at first publication.
create or replace function public.guard_launcher_pack_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'launcher packs must begin as draft' using errcode = '23514';
    end if;
    new.published_at := null;
    return new;
  end if;

  if exists (
    select 1
    from public.week_competition_policies policy
    where policy.launcher_pack_id = old.pack_id
      and policy.week_id = old.week_id
  ) and new.competition_manifest_sha256 is null then
    raise exception 'a protected policy pack requires its canonical manifest'
      using errcode = '23514';
  end if;

  if old.status = 'draft' then
    if new.status not in ('draft', 'published') then
      raise exception 'invalid launcher pack transition from draft' using errcode = '23514';
    end if;
    if new.status = 'published' then
      new.published_at := now();
    else
      new.published_at := null;
    end if;
    return new;
  end if;

  if new.status not in ('published', 'disabled') then
    raise exception 'published launcher packs cannot return to draft' using errcode = '23514';
  end if;

  if old.status = 'published' and new.status = 'disabled' and exists (
    select 1
    from public.week_competition_policies policy
    where policy.launcher_pack_id = old.pack_id
      and policy.week_id = old.week_id
      and policy.frozen_at is null
  ) then
    raise exception 'an unfrozen competition policy pack cannot be disabled'
      using errcode = '23514';
  end if;

  if new.pack_id is distinct from old.pack_id
    or new.week_id is distinct from old.week_id
    or new.size_bytes is distinct from old.size_bytes
    or new.sha256 is distinct from old.sha256
    or new.competition_manifest_sha256 is distinct from old.competition_manifest_sha256
    or new.published_at is distinct from old.published_at then
    raise exception 'published launcher pack identity and bytes are immutable' using errcode = '23514';
  end if;

  return new;
end;
$$;

alter table public.submissions
  add column launcher_pack_id text,
  add column competition_integrity_version smallint,
  add column competition_manifest_sha256 text,
  add column competition_policy_fingerprint text,
  add column competition_run_id text,
  add column competition_candidate_id text;

alter table public.submissions
  add constraint submissions_launcher_pack_fk
    foreign key (launcher_pack_id) references public.launcher_packs(pack_id) on delete restrict,
  add constraint submissions_competition_manifest_sha256_check
    check (
      competition_manifest_sha256 is null
      or competition_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint submissions_competition_policy_fingerprint_check
    check (
      competition_policy_fingerprint is null
      or competition_policy_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint submissions_competition_run_id_check
    check (
      competition_run_id is null
      or (char_length(competition_run_id) between 1 and 128 and competition_run_id !~ '[[:cntrl:]]')
    ),
  add constraint submissions_competition_candidate_id_check
    check (
      competition_candidate_id is null
      or (char_length(competition_candidate_id) between 1 and 192 and competition_candidate_id !~ '[[:cntrl:]]')
    ),
  add constraint submissions_competition_identity_all_or_none_check
    check (
      (
        competition_integrity_version is null
        and launcher_pack_id is null
        and competition_manifest_sha256 is null
        and competition_policy_fingerprint is null
        and competition_run_id is null
        and competition_candidate_id is null
      )
      or
      (
        competition_integrity_version = 2
        and launcher_pack_id is not null
        and competition_manifest_sha256 is not null
        and competition_policy_fingerprint is not null
        and (
          (
            competition_run_id is not null
            and competition_candidate_id is not null
          )
          or
          (
            competition_run_id is null
            and competition_candidate_id is null
          )
        )
      )
    );

create unique index submissions_protected_candidate_unique_idx
on public.submissions (
  player_id,
  launcher_pack_id,
  competition_run_id,
  competition_candidate_id
)
where competition_integrity_version = 2;

comment on column public.submissions.launcher_pack_id is
  'Server-validated canonical pack revision for Protected Competition; preserved after anonymization.';
comment on column public.submissions.competition_integrity_version is
  'Server-validated competition evidence version. NULL identifies legacy rows.';
comment on column public.submissions.competition_manifest_sha256 is
  'Server-validated canonical competition manifest; preserved after anonymization.';
comment on column public.submissions.competition_policy_fingerprint is
  'Exact DB-owned policy identity used by WEB validation; preserved after anonymization.';
comment on column public.submissions.competition_run_id is
  'Per-run technical identity; cleared during profile anonymization.';
comment on column public.submissions.competition_candidate_id is
  'Per-candidate technical identity; cleared during profile anonymization.';

create or replace function public.guard_submission_competition_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy public.week_competition_policies%rowtype;
  pack public.launcher_packs%rowtype;
begin
  select value.*
  into policy
  from public.week_competition_policies value
  where value.week_id = new.week_id
  for update;

  if not found then
    if new.competition_integrity_version is not null
        or new.competition_policy_fingerprint is not null then
      raise exception 'competition authority changed before submission insert'
        using errcode = '40001';
    end if;
    return new;
  end if;

  select value.*
  into pack
  from public.launcher_packs value
  where value.pack_id = policy.launcher_pack_id
    and value.week_id = policy.week_id
  for update;

  if new.competition_policy_fingerprint is distinct from policy.policy_fingerprint then
    raise exception 'competition authority changed before submission insert'
      using errcode = '40001';
  end if;

  if not found
      or pack.published_at is null
      or (policy.frozen_at is null and pack.status <> 'published')
      or (policy.frozen_at is not null and pack.status not in ('published', 'disabled'))
      or pack.competition_manifest_sha256 is null
      or new.competition_integrity_version is distinct from 2
      or new.launcher_pack_id is distinct from policy.launcher_pack_id
      or new.competition_manifest_sha256 is distinct from pack.competition_manifest_sha256
      or new.rom_name is distinct from policy.rom_name
      or new.mame_version is distinct from policy.mame_version
      or new.source is distinct from policy.source
      or new.competition_run_id is null
      or new.competition_candidate_id is null
      or new.duplicate_key is null
      or new.duplicate_key !~ '^hsl:v2:[0-9a-f]{64}$' then
    raise exception 'protected submission row contradicts canonical competition policy'
      using errcode = '23514';
  end if;

  if policy.frozen_at is null then
    update public.week_competition_policies value
    set frozen_at = statement_timestamp()
    where value.week_id = policy.week_id
      and value.frozen_at is null;
  end if;

  return new;
end;
$$;

create trigger submissions_guard_competition_integrity
before insert on public.submissions
for each row execute function public.guard_submission_competition_integrity();

create or replace function public.guard_submission_competition_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  protected_technical_fields_changed boolean;
begin
  if old.competition_integrity_version is null then
    if new.competition_integrity_version is not null
        or new.launcher_pack_id is not null
        or new.competition_manifest_sha256 is not null
        or new.competition_policy_fingerprint is not null
        or new.competition_run_id is not null
        or new.competition_candidate_id is not null then
      raise exception 'legacy submission cannot become Protected through UPDATE'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.week_id is distinct from old.week_id
      or new.player_id is distinct from old.player_id
      or new.score is distinct from old.score
      or new.source is distinct from old.source
      or new.detected_at is distinct from old.detected_at
      or new.rom_name is distinct from old.rom_name
      or new.launcher_pack_id is distinct from old.launcher_pack_id
      or new.competition_integrity_version is distinct from old.competition_integrity_version
      or new.competition_manifest_sha256 is distinct from old.competition_manifest_sha256
      or new.competition_policy_fingerprint is distinct from old.competition_policy_fingerprint then
    raise exception 'canonical Protected submission history is immutable'
      using errcode = '23514';
  end if;

  protected_technical_fields_changed :=
    new.raw_event is distinct from old.raw_event
    or new.mame_version is distinct from old.mame_version
    or new.client_version is distinct from old.client_version
    or new.duplicate_key is distinct from old.duplicate_key
    or new.competition_run_id is distinct from old.competition_run_id
    or new.competition_candidate_id is distinct from old.competition_candidate_id;

  if protected_technical_fields_changed and not (
    new.raw_event is null
    and new.mame_version is null
    and new.client_version is null
    and new.duplicate_key is null
    and new.competition_run_id is null
    and new.competition_candidate_id is null
  ) then
    raise exception 'Protected technical identity may only be cleared by the privacy scrub'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger submissions_guard_competition_history
before update on public.submissions
for each row execute function public.guard_submission_competition_history();

alter table public.week_competition_policies enable row level security;

revoke all on table public.week_competition_policies from public, anon, authenticated;
grant select, delete on table public.week_competition_policies to authenticated;
grant insert (
  week_id,
  policy_version,
  mode,
  launcher_pack_id,
  evidence_version,
  guard_version,
  rom_name,
  mame_version,
  plugin_version,
  source,
  dips
) on public.week_competition_policies to authenticated;
grant update (
  policy_version,
  mode,
  launcher_pack_id,
  evidence_version,
  guard_version,
  rom_name,
  mame_version,
  plugin_version,
  source,
  dips
) on public.week_competition_policies to authenticated;
grant select on table public.week_competition_policies to service_role;

create policy week_competition_policies_admin_all
on public.week_competition_policies
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- The ingest API is the single productive write boundary for normal players and admins.
drop policy if exists submissions_insert_own on public.submissions;
drop policy if exists submissions_admin_all on public.submissions;
revoke insert, update, delete on table public.submissions from anon, authenticated;
grant select on table public.submissions to authenticated;
grant update (is_valid, is_hidden) on table public.submissions to authenticated;
grant select, insert, update, delete on table public.submissions to service_role;

create policy submissions_admin_select
on public.submissions for select to authenticated
using (public.is_admin());

create policy submissions_admin_update
on public.submissions for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Keep canonical pack/manifest/policy identity, but remove per-run technical identifiers on anonymization.
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
      select current_profile.id, current_profile.username, current_profile.anonymized_at, true;
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
    profile_id, username_fingerprint, retired_at
  ) values (
    current_profile.id, public.profile_username_fingerprint(old_username), deleted_at
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
      when unique_violation then generated_alias := null;
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
    duplicate_key = null,
    competition_run_id = null,
    competition_candidate_id = null
  where player_id = current_profile.id;

  update public.season_memberships membership
  set status = 'left'
  from public.seasons season
  where membership.player_id = current_profile.id
    and membership.status = 'active'
    and season.id = membership.season_id
    and season.status = 'active';

  delete from public.play_time_events where player_id = current_profile.id;
  delete from public.player_game_play_time where player_id = current_profile.id;
  delete from public.player_play_time_totals where player_id = current_profile.id;

  update public.league_chat_messages
  set content = generated_alias || ' se unió al chat.'
  where message_type = 'system'
    and author_id is null
    and content = old_username || ' se unió al chat.';

  return query select current_profile.id, generated_alias, deleted_at, false;
end;
$$;

comment on function public.anonymize_profile_account(uuid) is
  'Service-role-only anonymization. Preserves canonical competition history and clears per-run technical identity.';
revoke all on function public.anonymize_profile_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_profile_account(uuid) to service_role;
