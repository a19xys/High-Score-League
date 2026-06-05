-- High Score League - League chat message editing
-- Apply after 0013_league_chat_message_limits.sql.

alter table public.league_chat_messages
add column if not exists edited_at timestamptz;

create or replace function public.prepare_league_chat_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.id <> new.id
    or old.message_type <> new.message_type
    or old.author_id is distinct from new.author_id
    or old.created_at <> new.created_at
  then
    raise exception 'league chat message identity fields cannot be edited';
  end if;

  if old.content is distinct from new.content
    and new.message_type = 'user'
  then
    new.edited_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists league_chat_messages_prepare_update
on public.league_chat_messages;

create trigger league_chat_messages_prepare_update
before update on public.league_chat_messages
for each row execute function public.prepare_league_chat_message_update();

create or replace function public.is_latest_own_league_chat_message(
  message_id uuid,
  message_created_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.league_chat_messages newer
    where newer.message_type = 'user'
      and newer.author_id = auth.uid()
      and (
        newer.created_at > message_created_at
        or (
          newer.created_at = message_created_at
          and newer.id > message_id
        )
      )
  );
$$;

drop policy if exists league_chat_messages_update_user_own_recent
on public.league_chat_messages;

create policy league_chat_messages_update_user_own_recent
on public.league_chat_messages
for update
to authenticated
using (
  message_type = 'user'
  and author_id = auth.uid()
  and created_at >= now() - interval '15 minutes'
  and public.is_latest_own_league_chat_message(id, created_at)
)
with check (
  message_type = 'user'
  and author_id = auth.uid()
  and created_at >= now() - interval '15 minutes'
  and length(trim(content)) > 0
  and char_length(content) <= 65536
  and public.is_latest_own_league_chat_message(id, created_at)
);
