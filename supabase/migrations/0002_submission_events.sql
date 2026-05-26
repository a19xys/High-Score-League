-- High Score League - Submission events for future MAME/local app ingestion
-- Apply after 0001_initial_schema.sql.

alter table public.submissions
  alter column screenshot_path drop not null;

alter table public.submissions
  drop constraint if exists submissions_screenshot_path_not_blank;

alter table public.submissions
  add constraint submissions_screenshot_path_blank_or_null check (
    screenshot_path is null or length(trim(screenshot_path)) > 0
  );

alter table public.submissions
  add column if not exists source text not null default 'web',
  add column if not exists detected_at timestamptz,
  add column if not exists rom_name text,
  add column if not exists mame_version text,
  add column if not exists client_version text,
  add column if not exists raw_event jsonb,
  add column if not exists duplicate_key text;

alter table public.submissions
  add constraint submissions_source_check check (
    source in ('web', 'mame_memory', 'mame_plugin', 'local_app', 'admin_import')
  ),
  add constraint submissions_rom_name_blank_or_null check (
    rom_name is null or length(trim(rom_name)) > 0
  ),
  add constraint submissions_mame_version_blank_or_null check (
    mame_version is null or length(trim(mame_version)) > 0
  ),
  add constraint submissions_client_version_blank_or_null check (
    client_version is null or length(trim(client_version)) > 0
  ),
  add constraint submissions_duplicate_key_blank_or_null check (
    duplicate_key is null or length(trim(duplicate_key)) > 0
  ),
  add constraint submissions_raw_event_object_or_null check (
    raw_event is null or jsonb_typeof(raw_event) = 'object'
  );

create index if not exists submissions_detected_at_idx
on public.submissions (detected_at desc);

create index if not exists submissions_week_player_detected_idx
on public.submissions (week_id, player_id, detected_at desc);

create index if not exists submissions_source_idx
on public.submissions (source);

create unique index if not exists submissions_duplicate_key_unique_idx
on public.submissions (duplicate_key)
where duplicate_key is not null;

comment on column public.submissions.source is
  'Origin of the submission: web, mame_memory, mame_plugin, local_app or admin_import.';

comment on column public.submissions.detected_at is
  'Moment when MAME or the local app detected the score event.';

comment on column public.submissions.submitted_at is
  'Moment when the web backend received the submission. Forced by server trigger.';

comment on column public.submissions.raw_event is
  'Original event payload kept for debugging and audit. Validated columns remain canonical.';

comment on column public.submissions.duplicate_key is
  'Client-generated idempotency key for retries. Must include enough scope to avoid collisions.';
