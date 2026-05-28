-- High Score League - Enable Realtime for global league chat
-- Apply after 0006_league_chat.sql.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_chat_messages'
  ) then
    alter publication supabase_realtime add table public.league_chat_messages;
  end if;
end;
$$;
