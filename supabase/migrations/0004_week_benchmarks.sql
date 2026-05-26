-- High Score League - Visual weekly leaderboard benchmarks
-- Apply after 0003_season_memberships_and_results.sql.

create table if not exists public.week_benchmarks (
  id uuid primary key default extensions.gen_random_uuid(),
  week_id uuid not null references public.weeks(id) on delete cascade,
  label text not null,
  score bigint not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint week_benchmarks_label_not_blank check (length(trim(label)) > 0),
  constraint week_benchmarks_score_non_negative check (score >= 0),
  constraint week_benchmarks_description_blank_or_null check (
    description is null or length(trim(description)) > 0
  ),
  constraint week_benchmarks_unique_week_label unique (week_id, label)
);

create index if not exists week_benchmarks_week_id_idx
on public.week_benchmarks (week_id);

create index if not exists week_benchmarks_week_active_idx
on public.week_benchmarks (week_id, is_active);

create index if not exists week_benchmarks_week_score_idx
on public.week_benchmarks (week_id, score desc);

create trigger week_benchmarks_set_updated_at
before update on public.week_benchmarks
for each row execute function public.set_updated_at();

alter table public.week_benchmarks enable row level security;

create policy week_benchmarks_select_active_authenticated
on public.week_benchmarks
for select
to authenticated
using (is_active = true);

create policy week_benchmarks_admin_all
on public.week_benchmarks
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
