alter table public.games
  add column if not exists accent_color_primary text,
  add column if not exists accent_color_secondary text;

alter table public.games
  add constraint games_accent_color_primary_hex_check
  check (
    accent_color_primary is null
    or accent_color_primary ~ '^#[0-9A-Fa-f]{6}$'
  );

alter table public.games
  add constraint games_accent_color_secondary_hex_check
  check (
    accent_color_secondary is null
    or accent_color_secondary ~ '^#[0-9A-Fa-f]{6}$'
  );
