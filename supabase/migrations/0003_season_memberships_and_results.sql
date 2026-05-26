-- High Score League - Season memberships and official weekly result generation
-- Apply after 0002_submission_events.sql.

create table if not exists public.season_memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint season_memberships_unique_season_player unique (season_id, player_id),
  constraint season_memberships_status_check check (status in ('active', 'left'))
);

create index if not exists season_memberships_season_id_idx
on public.season_memberships (season_id);

create index if not exists season_memberships_player_id_idx
on public.season_memberships (player_id);

create index if not exists season_memberships_season_player_idx
on public.season_memberships (season_id, player_id);

alter table public.season_memberships enable row level security;

create policy season_memberships_select_authenticated
on public.season_memberships
for select
to authenticated
using (true);

create policy season_memberships_insert_own_active_season
on public.season_memberships
for insert
to authenticated
with check (
  player_id = auth.uid()
  and status = 'active'
  and exists (
    select 1
    from public.seasons s
    where s.id = season_id
      and s.status = 'active'
  )
);

create policy season_memberships_admin_all
on public.season_memberships
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
