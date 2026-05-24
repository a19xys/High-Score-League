-- High Score League - Initial Supabase schema
-- Apply from the Supabase SQL editor or through the Supabase CLI.

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  initials text not null,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_not_blank check (length(trim(username)) > 0),
  constraint profiles_initials_not_blank check (length(trim(initials)) > 0),
  constraint profiles_initials_exact_length check (char_length(trim(initials)) = 3)
);

create unique index profiles_username_lower_unique_idx on public.profiles (lower(trim(username)));
create unique index profiles_initials_lower_unique_idx on public.profiles (lower(trim(initials)));

create table public.seasons (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text unique not null,
  version text,
  status text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_name_not_blank check (length(trim(name)) > 0),
  constraint seasons_slug_not_blank check (length(trim(slug)) > 0),
  constraint seasons_status_check check (status in ('draft', 'active', 'completed')),
  constraint seasons_date_order check (
    starts_at is null
    or ends_at is null
    or starts_at <= ends_at
  )
);

create table public.games (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  year integer,
  developer text,
  publisher text,
  rom_name text,
  image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_title_not_blank check (length(trim(title)) > 0),
  constraint games_year_reasonable check (year is null or year between 1970 and 2100)
);

create table public.weeks (
  id uuid primary key default extensions.gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  game_id uuid not null references public.games(id),
  week_number integer not null,
  status text not null,
  public_start_at timestamptz,
  public_freeze_at timestamptz,
  final_deadline_at timestamptz,
  reveal_at timestamptz,
  rules_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weeks_week_number_positive check (week_number > 0),
  constraint weeks_status_check check (
    status in ('draft', 'active', 'frozen', 'closed', 'published')
  ),
  constraint weeks_unique_season_week unique (season_id, week_number),
  constraint weeks_start_before_freeze check (
    public_start_at is null
    or public_freeze_at is null
    or public_start_at <= public_freeze_at
  ),
  constraint weeks_freeze_before_deadline check (
    public_freeze_at is null
    or final_deadline_at is null
    or public_freeze_at <= final_deadline_at
  ),
  constraint weeks_deadline_before_reveal check (
    final_deadline_at is null
    or reveal_at is null
    or final_deadline_at <= reveal_at
  ),
  constraint weeks_start_before_deadline check (
    public_start_at is null
    or final_deadline_at is null
    or public_start_at <= final_deadline_at
  ),
  constraint weeks_start_before_reveal check (
    public_start_at is null
    or reveal_at is null
    or public_start_at <= reveal_at
  ),
  constraint weeks_freeze_before_reveal check (
    public_freeze_at is null
    or reveal_at is null
    or public_freeze_at <= reveal_at
  )
);

create table public.submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  week_id uuid not null references public.weeks(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  score bigint not null,
  screenshot_path text not null,
  screenshot_mime_type text,
  screenshot_size_bytes integer,
  comment text,
  is_hidden boolean not null default false,
  is_valid boolean not null default true,
  submitted_at timestamptz not null default now(),
  constraint submissions_score_non_negative check (score >= 0),
  constraint submissions_screenshot_path_not_blank check (length(trim(screenshot_path)) > 0),
  constraint submissions_screenshot_size_positive check (
    screenshot_size_bytes is null or screenshot_size_bytes > 0
  )
);

create table public.weekly_results (
  id uuid primary key default extensions.gen_random_uuid(),
  week_id uuid not null references public.weeks(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  final_score bigint not null,
  rank integer not null,
  league_points numeric(4, 1) not null default 0,
  is_first_place boolean not null default false,
  is_second_place boolean not null default false,
  is_third_place boolean not null default false,
  created_at timestamptz not null default now(),
  constraint weekly_results_unique_week_player unique (week_id, player_id),
  constraint weekly_results_final_score_non_negative check (final_score >= 0),
  constraint weekly_results_rank_positive check (rank > 0),
  constraint weekly_results_league_points_non_negative check (league_points >= 0)
);

create index submissions_week_id_idx on public.submissions (week_id);
create index submissions_player_id_idx on public.submissions (player_id);
create index submissions_week_player_idx on public.submissions (week_id, player_id);
create index submissions_week_valid_idx on public.submissions (week_id, is_valid);
create index weekly_results_week_id_idx on public.weekly_results (week_id);
create index weekly_results_player_id_idx on public.weekly_results (player_id);
create index weeks_season_id_idx on public.weeks (season_id);
create index weeks_status_idx on public.weeks (status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger seasons_set_updated_at
before update on public.seasons
for each row execute function public.set_updated_at();

create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_updated_at();

create trigger weeks_set_updated_at
before update on public.weeks
for each row execute function public.set_updated_at();

create or replace function public.force_submission_submitted_at()
returns trigger
language plpgsql
as $$
begin
  new.submitted_at = now();
  return new;
end;
$$;

create trigger submissions_force_submitted_at
before insert on public.submissions
for each row execute function public.force_submission_submitted_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.is_admin
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    ),
    false
  );
$$;

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.games enable row level security;
alter table public.weeks enable row level security;
alter table public.submissions enable row level security;
alter table public.weekly_results enable row level security;

create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid() and is_admin = false);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and is_admin = false);

create policy profiles_admin_all
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy seasons_select_authenticated
on public.seasons
for select
to authenticated
using (true);

create policy seasons_admin_all
on public.seasons
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy games_select_authenticated
on public.games
for select
to authenticated
using (true);

create policy games_admin_all
on public.games
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy weeks_select_authenticated
on public.weeks
for select
to authenticated
using (true);

create policy weeks_admin_all
on public.weeks
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy submissions_select_visible
on public.submissions
for select
to authenticated
using (is_hidden = false and is_valid = true);

create policy submissions_select_own
on public.submissions
for select
to authenticated
using (player_id = auth.uid());

create policy submissions_insert_own
on public.submissions
for insert
to authenticated
with check (
  player_id = auth.uid()
  and is_valid = true
  and exists (
    select 1
    from public.weeks w
    where w.id = week_id
      and (
        (w.status = 'active' and is_hidden in (true, false))
        or (w.status = 'frozen' and is_hidden = true)
      )
  )
);

create policy submissions_admin_all
on public.submissions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy weekly_results_select_authenticated
on public.weekly_results
for select
to authenticated
using (true);

create policy weekly_results_admin_all
on public.weekly_results
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
