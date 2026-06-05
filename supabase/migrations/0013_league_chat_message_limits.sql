-- High Score League - League chat limits and retention
-- Apply after 0012_optional_week_game.sql.

alter table public.league_chat_messages
drop constraint if exists league_chat_messages_content_max_length;

alter table public.league_chat_messages
add constraint league_chat_messages_content_max_length
check (char_length(content) <= 65536);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'league_chat_messages_content_not_blank'
      and conrelid = 'public.league_chat_messages'::regclass
  ) then
    alter table public.league_chat_messages
    add constraint league_chat_messages_content_not_blank
    check (length(trim(content)) > 0);
  end if;
end $$;

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
    offset 75
  );

  return new;
end;
$$;

drop policy if exists league_chat_messages_insert_user_own
on public.league_chat_messages;

create policy league_chat_messages_insert_user_own
on public.league_chat_messages
for insert
to authenticated
with check (
  message_type = 'user'
  and author_id = auth.uid()
  and length(trim(content)) > 0
  and char_length(content) <= 65536
);
