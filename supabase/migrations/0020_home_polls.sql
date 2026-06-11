-- High Score League - Singleton home poll model
-- Apply after 0019_week_benchmark_icon_key.sql.

create table if not exists public.home_polls (
  id uuid primary key default extensions.gen_random_uuid(),
  singleton_key boolean not null default true unique,
  question text not null default '',
  enabled boolean not null default false,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_polls_singleton_key_check check (singleton_key),
  constraint home_polls_question_not_blank_when_enabled
    check (enabled = false or length(trim(question)) > 0)
);

create table if not exists public.home_poll_options (
  id uuid primary key default extensions.gen_random_uuid(),
  poll_id uuid not null references public.home_polls(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint home_poll_options_label_not_blank check (length(trim(label)) > 0),
  constraint home_poll_options_sort_order_check check (sort_order >= 0),
  constraint home_poll_options_id_poll_unique unique (id, poll_id)
);

create table if not exists public.home_poll_votes (
  id uuid primary key default extensions.gen_random_uuid(),
  poll_id uuid not null references public.home_polls(id) on delete cascade,
  option_id uuid not null,
  player_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_poll_votes_unique_poll_player unique (poll_id, player_id),
  constraint home_poll_votes_option_same_poll
    foreign key (option_id, poll_id)
    references public.home_poll_options (id, poll_id)
    on delete cascade
);

create index if not exists home_poll_options_poll_id_idx
on public.home_poll_options (poll_id, sort_order);

create index if not exists home_poll_votes_poll_id_idx
on public.home_poll_votes (poll_id);

create index if not exists home_poll_votes_option_id_idx
on public.home_poll_votes (option_id);

create index if not exists home_poll_votes_player_id_idx
on public.home_poll_votes (player_id);

create trigger home_polls_set_updated_at
before update on public.home_polls
for each row execute function public.set_updated_at();

create trigger home_poll_votes_set_updated_at
before update on public.home_poll_votes
for each row execute function public.set_updated_at();

alter table public.home_polls enable row level security;
alter table public.home_poll_options enable row level security;
alter table public.home_poll_votes enable row level security;

create policy home_polls_select_active
on public.home_polls
for select
to authenticated
using (
  enabled = true
  and length(trim(question)) > 0
  and (closes_at is null or closes_at > now())
);

create policy home_polls_admin_all
on public.home_polls
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy home_poll_options_select_active_poll
on public.home_poll_options
for select
to authenticated
using (
  exists (
    select 1
    from public.home_polls p
    where p.id = poll_id
      and p.enabled = true
      and length(trim(p.question)) > 0
      and (p.closes_at is null or p.closes_at > now())
  )
);

create policy home_poll_options_admin_all
on public.home_poll_options
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy home_poll_votes_select_own
on public.home_poll_votes
for select
to authenticated
using (player_id = auth.uid());

create policy home_poll_votes_insert_own_active_poll
on public.home_poll_votes
for insert
to authenticated
with check (
  player_id = auth.uid()
  and exists (
    select 1
    from public.home_polls p
    where p.id = poll_id
      and p.enabled = true
      and length(trim(p.question)) > 0
      and (p.closes_at is null or p.closes_at > now())
  )
  and exists (
    select 1
    from public.home_poll_options o
    where o.id = option_id
      and o.poll_id = home_poll_votes.poll_id
  )
);

create policy home_poll_votes_update_own_active_poll
on public.home_poll_votes
for update
to authenticated
using (player_id = auth.uid())
with check (
  player_id = auth.uid()
  and exists (
    select 1
    from public.home_polls p
    where p.id = poll_id
      and p.enabled = true
      and length(trim(p.question)) > 0
      and (p.closes_at is null or p.closes_at > now())
  )
  and exists (
    select 1
    from public.home_poll_options o
    where o.id = option_id
      and o.poll_id = home_poll_votes.poll_id
  )
);

create policy home_poll_votes_admin_all
on public.home_poll_votes
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
