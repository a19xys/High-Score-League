-- Optional visual assets for future week headers.

alter table public.games
  add column if not exists header_image_url text,
  add column if not exists logo_image_url text;

alter table public.games
  drop constraint if exists games_header_image_url_http,
  drop constraint if exists games_logo_image_url_http;

alter table public.games
  add constraint games_header_image_url_http check (
    header_image_url is null
    or header_image_url ~* '^https?://'
  ),
  add constraint games_logo_image_url_http check (
    logo_image_url is null
    or logo_image_url ~* '^https?://'
  );
