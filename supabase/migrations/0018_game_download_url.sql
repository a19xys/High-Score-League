alter table public.games
  add column if not exists download_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'games_download_url_http_check'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_download_url_http_check
      check (
        download_url is null
        or download_url ~ '^https?://'
      );
  end if;
end $$;
