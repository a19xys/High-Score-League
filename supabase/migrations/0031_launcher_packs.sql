-- Private launcher pack catalog. R2 stores bytes; Supabase remains identity authority.

create table public.launcher_packs (
  pack_id text primary key,
  week_id uuid not null references public.weeks(id) on delete restrict,
  size_bytes bigint not null,
  sha256 text not null,
  object_key text generated always as (
    'packs/v1/' || pack_id || '/' || sha256 || '.hslpack.zip'
  ) stored,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launcher_packs_pack_id_check
    check (pack_id ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  constraint launcher_packs_size_bytes_check
    check (size_bytes > 0 and size_bytes <= 1073741824),
  constraint launcher_packs_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint launcher_packs_status_check
    check (status in ('draft', 'published', 'disabled')),
  constraint launcher_packs_publication_state_check
    check (
      (status = 'draft' and published_at is null)
      or (status in ('published', 'disabled') and published_at is not null)
    )
);

comment on table public.launcher_packs is
  'Private catalog mapping immutable launcher pack identity to canonical R2 bytes.';
comment on column public.launcher_packs.object_key is
  'Canonical derived key packs/v1/<pack_id>/<sha256>.hslpack.zip; never client-authored.';

create unique index launcher_packs_one_published_per_week_idx
on public.launcher_packs (week_id)
where status = 'published';

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

  if new.pack_id is distinct from old.pack_id
    or new.week_id is distinct from old.week_id
    or new.size_bytes is distinct from old.size_bytes
    or new.sha256 is distinct from old.sha256
    or new.published_at is distinct from old.published_at then
    raise exception 'published launcher pack identity and bytes are immutable' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger launcher_packs_guard_lifecycle
before insert or update on public.launcher_packs
for each row execute function public.guard_launcher_pack_lifecycle();

create trigger launcher_packs_set_updated_at
before update on public.launcher_packs
for each row execute function public.set_updated_at();

create or replace function public.guard_published_launcher_pack_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception 'published launcher packs cannot be deleted' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger launcher_packs_guard_published_delete
before delete on public.launcher_packs
for each row execute function public.guard_published_launcher_pack_delete();

alter table public.launcher_packs enable row level security;

revoke all on table public.launcher_packs from anon;
grant select, insert, update, delete on table public.launcher_packs to authenticated;
grant select on table public.launcher_packs to service_role;

create policy launcher_packs_admin_all
on public.launcher_packs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
