-- High Score League - Optional seed data
-- This seed creates season/game/week records only.
--
-- profiles and submissions depend on real auth.users rows. Do not insert fake
-- profile ids unless matching users already exist in auth.users.

insert into public.seasons (
  id,
  name,
  slug,
  version,
  status,
  starts_at,
  ends_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  'Temporada I',
  'temporada-i',
  'MVP',
  'active',
  '2026-05-18 00:00:00+00',
  '2026-07-12 23:59:59+00'
)
on conflict (slug) do update
set
  name = excluded.name,
  version = excluded.version,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at;

insert into public.games (
  id,
  title,
  year,
  developer,
  publisher,
  rom_name,
  notes
)
values (
  '20000000-0000-4000-8000-000000000001',
  'Space Invaders',
  1978,
  'Taito',
  'Taito / Midway',
  'spaceinv',
  'Primer juego de ejemplo para validar la estructura MVP.'
)
on conflict (id) do update
set
  title = excluded.title,
  year = excluded.year,
  developer = excluded.developer,
  publisher = excluded.publisher,
  rom_name = excluded.rom_name,
  notes = excluded.notes;

insert into public.weeks (
  id,
  season_id,
  game_id,
  week_number,
  status,
  public_start_at,
  public_freeze_at,
  final_deadline_at,
  reveal_at,
  rules_summary
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1,
  'active',
  '2026-05-18 00:00:00+00',
  '2026-05-23 23:59:59+00',
  '2026-05-24 23:59:59+00',
  '2026-05-25 20:00:00+00',
  'Una sola partida por subida. La captura debe mostrar puntuación final y siglas.'
)
on conflict (season_id, week_number) do update
set
  game_id = excluded.game_id,
  status = excluded.status,
  public_start_at = excluded.public_start_at,
  public_freeze_at = excluded.public_freeze_at,
  final_deadline_at = excluded.final_deadline_at,
  reveal_at = excluded.reveal_at,
  rules_summary = excluded.rules_summary;

-- Example profile/submission rows require matching auth.users ids:
--
-- insert into public.profiles (id, username, initials)
-- values
--   ('<auth-user-id-1>', 'lauravc', 'LVC'),
--   ('<auth-user-id-2>', 'mariosn', 'MSN'),
--   ('<auth-user-id-3>', 'nicorms', 'NRM');
--
-- insert into public.submissions (
--   week_id,
--   player_id,
--   score,
--   screenshot_path,
--   screenshot_mime_type,
--   screenshot_size_bytes,
--   comment
-- )
-- values
--   (
--     '30000000-0000-4000-8000-000000000001',
--     '<auth-user-id-1>',
--     184320,
--     'season-10000000-0000-4000-8000-000000000001/week-30000000-0000-4000-8000-000000000001/player-<auth-user-id-1>/2026-05-24T19-30-00.webp',
--     'image/webp',
--     842120,
--     'Submission de ejemplo.'
--   );
