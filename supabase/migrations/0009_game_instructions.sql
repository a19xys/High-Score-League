alter table public.games
add column if not exists instructions text,
add column if not exists manual_url text;

alter table public.games
drop constraint if exists games_instructions_not_blank,
add constraint games_instructions_not_blank check (
  instructions is null or length(trim(instructions)) > 0
);

alter table public.games
drop constraint if exists games_manual_url_not_blank,
add constraint games_manual_url_not_blank check (
  manual_url is null or length(trim(manual_url)) > 0
);

alter table public.games
drop constraint if exists games_manual_url_http,
add constraint games_manual_url_http check (
  manual_url is null or manual_url ~* '^https?://'
);
