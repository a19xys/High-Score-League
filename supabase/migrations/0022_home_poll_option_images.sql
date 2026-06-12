-- High Score League - Optional images for home poll options
-- Apply after 0021_home_poll_votes_realtime.sql.

alter table public.home_poll_options
  add column if not exists image_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'home_poll_options_image_url_check'
      and conrelid = 'public.home_poll_options'::regclass
  ) then
    alter table public.home_poll_options
      add constraint home_poll_options_image_url_check
      check (image_url is null or image_url ~* '^https?://');
  end if;
end $$;
