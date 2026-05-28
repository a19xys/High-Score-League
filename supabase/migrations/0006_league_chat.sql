-- High Score League - Global league chat
-- Apply after 0005_game_metadata.sql.

create table if not exists public.league_chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  message_type text not null default 'user',
  author_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint league_chat_messages_type_check check (
    message_type in ('user', 'system')
  ),
  constraint league_chat_messages_content_not_blank check (
    length(trim(content)) > 0
  ),
  constraint league_chat_messages_content_max_length check (
    char_length(content) <= 500
  ),
  constraint league_chat_messages_author_by_type check (
    (message_type = 'user' and author_id is not null)
    or (message_type = 'system' and author_id is null)
  )
);

create index if not exists league_chat_messages_created_at_idx
on public.league_chat_messages (created_at desc, id desc);

create index if not exists league_chat_messages_author_id_idx
on public.league_chat_messages (author_id);

create or replace function public.trim_league_chat_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.league_chat_messages
  where id in (
    select id
    from public.league_chat_messages
    order by created_at desc, id desc
    offset 50
  );

  return new;
end;
$$;

drop trigger if exists league_chat_messages_trim_after_insert
on public.league_chat_messages;

create trigger league_chat_messages_trim_after_insert
after insert on public.league_chat_messages
for each row execute function public.trim_league_chat_messages();

create or replace function public.insert_league_chat_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.league_chat_messages (message_type, author_id, content)
  values ('system', null, new.username || ' se unió al chat.');

  return new;
end;
$$;

drop trigger if exists profiles_insert_league_chat_message
on public.profiles;

create trigger profiles_insert_league_chat_message
after insert on public.profiles
for each row execute function public.insert_league_chat_profile_created();

alter table public.league_chat_messages enable row level security;

create policy league_chat_messages_select_authenticated
on public.league_chat_messages
for select
to authenticated
using (true);

create policy league_chat_messages_insert_user_own
on public.league_chat_messages
for insert
to authenticated
with check (
  message_type = 'user'
  and author_id = auth.uid()
  and length(trim(content)) > 0
  and char_length(content) <= 500
);

create policy league_chat_messages_admin_all
on public.league_chat_messages
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
