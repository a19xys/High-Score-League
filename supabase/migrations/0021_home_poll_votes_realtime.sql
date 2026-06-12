-- High Score League - Enable Realtime for home poll votes
-- Apply after 0020_home_polls.sql.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'home_poll_votes'
  ) then
    alter publication supabase_realtime add table public.home_poll_votes;
  end if;
end;
$$;
