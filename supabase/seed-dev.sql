-- High Score League development seed.
-- Ejecutar despues de supabase/migrations/0001_initial_schema.sql.
-- No inserta perfiles ni submissions porque dependen de usuarios reales de Auth.

insert into public.seasons (
  id,
  name,
  slug,
  version,
  status,
  starts_at,
  ends_at
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'Temporada I',
    'temporada-i',
    'MVP',
    'active',
    '2026-05-18T00:00:00+02:00',
    '2026-07-12T23:59:00+02:00'
  ),
  (
    '11111111-1111-4111-8111-111111111100',
    'Pretemporada',
    'pretemporada',
    'Piloto',
    'completed',
    '2026-04-06T00:00:00+02:00',
    '2026-04-27T23:59:00+02:00'
  ),
  (
    '11111111-1111-4111-8111-111111111200',
    'Temporada II',
    'temporada-ii',
    'Planificada',
    'draft',
    '2026-09-07T00:00:00+02:00',
    '2026-11-01T23:59:00+01:00'
  )
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
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
  image_url,
  notes
) values
  (
    '22222222-2222-4222-8222-222222222201',
    'Galaga',
    1981,
    'Namco',
    'Namco',
    'galaga',
    null,
    'Genero: fixed shooter. Control: estandar. Dificultad: media.'
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    'Centipede',
    1981,
    'Atari',
    'Atari',
    'centiped',
    null,
    'Genero: shooter. Control: trackball. Dificultad: media.'
  ),
  (
    '22222222-2222-4222-8222-222222222203',
    'Robotron: 2084',
    1982,
    'Williams',
    'Williams',
    'robotron',
    null,
    'Genero: arena shooter. Control: doble stick. Dificultad: alta.'
  ),
  (
    '22222222-2222-4222-8222-222222222299',
    'Juego secreto',
    null,
    null,
    null,
    null,
    null,
    'Placeholder para semanas futuras. El esquema actual exige game_id no nulo.'
  )
on conflict (id) do update set
  title = excluded.title,
  year = excluded.year,
  developer = excluded.developer,
  publisher = excluded.publisher,
  rom_name = excluded.rom_name,
  image_url = excluded.image_url,
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
) values
  (
    '33333333-3333-4333-8333-333333333001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222201',
    1,
    'active',
    '2026-05-18T00:00:00+02:00',
    '2026-05-22T23:59:00+02:00',
    '2026-05-24T23:59:00+02:00',
    '2026-05-25T00:00:00+02:00',
    'Una sola partida por subida.
La captura debe mostrar puntuacion final y siglas.
Se permiten varias puntuaciones validas durante la semana.'
  ),
  (
    '33333333-3333-4333-8333-333333333002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222299',
    2,
    'draft',
    '2026-05-25T00:00:00+02:00',
    '2026-05-29T23:59:00+02:00',
    '2026-05-31T23:59:00+02:00',
    '2026-06-01T00:00:00+02:00',
    'Juego pendiente de revelar.'
  ),
  (
    '33333333-3333-4333-8333-333333333003',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222299',
    3,
    'draft',
    '2026-06-01T00:00:00+02:00',
    '2026-06-05T23:59:00+02:00',
    '2026-06-07T23:59:00+02:00',
    '2026-06-08T00:00:00+02:00',
    'Juego pendiente de revelar.'
  ),
  (
    '33333333-3333-4333-8333-333333333101',
    '11111111-1111-4111-8111-111111111100',
    '22222222-2222-4222-8222-222222222202',
    1,
    'published',
    '2026-04-06T00:00:00+02:00',
    '2026-04-10T23:59:00+02:00',
    '2026-04-12T23:59:00+02:00',
    '2026-04-13T00:00:00+02:00',
    'Settings por defecto.
Sin continues.
Captura final obligatoria.'
  ),
  (
    '33333333-3333-4333-8333-333333333102',
    '11111111-1111-4111-8111-111111111100',
    '22222222-2222-4222-8222-222222222203',
    2,
    'closed',
    '2026-04-13T00:00:00+02:00',
    '2026-04-17T23:59:00+02:00',
    '2026-04-19T23:59:00+02:00',
    '2026-04-20T00:00:00+02:00',
    'Dificultad por defecto.
Partida desde cero.'
  )
on conflict (id) do update set
  season_id = excluded.season_id,
  game_id = excluded.game_id,
  week_number = excluded.week_number,
  status = excluded.status,
  public_start_at = excluded.public_start_at,
  public_freeze_at = excluded.public_freeze_at,
  final_deadline_at = excluded.final_deadline_at,
  reveal_at = excluded.reveal_at,
  rules_summary = excluded.rules_summary;
