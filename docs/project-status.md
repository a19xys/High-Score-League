# Project status

High Score League esta conectada a Supabase y usa datos reales en la experiencia
normal.

## Estado actual

- Next.js App Router, TypeScript y Tailwind.
- Landing publica para visitantes sin sesion.
- Rutas privadas protegidas con `AccessRequired`.
- Auth real con email/password y perfiles reales.
- Juegos, temporadas, semanas, submissions, leaderboards, `weekly_results`,
  clasificacion de temporada, benchmarks y chat global leen Supabase. El chat
  permite editar el último mensaje propio durante 15 minutos.
- El panel admin permite gestionar juegos, temporadas, semanas, submissions,
  benchmarks, cuestionarios y resultados oficiales. El catálogo de juegos usa
  metadatos múltiples para desarrolladores, editores, perspectivas, temas y
  géneros.
- La Home privada muestra un cuestionario único para usuarios registrados cuando
  está habilitado y abierto. El voto es editable y los resultados agregados se
  muestran solo después de votar. Las opciones admiten imagen opcional en modo
  todo-o-nada, con etiquetas compactas de hasta 80 caracteres.
- Los juegos pueden guardar URLs externas opcionales de header, logo y descarga
  del juego, además de colores manuales de acento para el borde/glow del hero.
  `image_url` y `rom_name` quedan como campos legacy/internos.
- Las semanas futuras pueden existir sin juego asignado (`weeks.game_id = null`).
  La UI pública las muestra como `Por anunciar` y el admin como
  `Sin juego asignado`; ya no se usa un juego placeholder real.
- `/game` redirige a la semana activa real.
- `/week` y `/leaderboard` redirigen a `/game`.
- `/season` redirige a `/seasons`.
- `/submit` se conserva como herramienta legacy/interna para admins. El flujo
  normal de puntuaciones sera la app local/MAME.
- `lib/mock-data.ts` fue eliminado y ya no existe fallback de producto a datos
  locales.
- `NEXT_PUBLIC_DATA_SOURCE` ya no se usa.

## Supabase

- La migracion principal esta en `supabase/migrations/0001_initial_schema.sql`.
- Las migraciones posteriores preparan submissions automaticas, memberships,
  benchmarks, chat, Realtime, preferencias de perfil y metadatos múltiples de
  juegos. `0012_optional_week_game.sql` hace opcional `weeks.game_id` para
  semanas futuras no anunciadas.
- `0016_game_week_assets.sql` añade `header_image_url` y `logo_image_url` a
  `games` para preparar la cabecera visual de semana.
- `0017_game_accent_colors.sql` añade `accent_color_primary` y
  `accent_color_secondary` con validación `#RRGGBB`.
- `0018_game_download_url.sql` añade `download_url` como enlace externo
  opcional con validación `http/https`.
- `0019_week_benchmark_icon_key.sql` añade `icon_key` a benchmarks para elegir
  entre `speedometer_1`, `speedometer_2` y `speedometer_3`.
- `0020_home_polls.sql` prepara el cuestionario único de Home con opciones,
  votos, singleton y RLS.
- `0021_home_poll_votes_realtime.sql` activa Realtime para votos del
  cuestionario.
- `0022_home_poll_option_images.sql` añade `image_url` opcional a las opciones
  del cuestionario de Home.
- `POST /api/submissions/ingest` crea submissions autenticadas.
- `POST /api/cron/process-schedule` sincroniza calendario por fechas.
- `POST /api/admin/weeks/[weekId]/weekly-results` genera resultados oficiales
  para admins.
- `/supabase-test` y `/real-data-test` siguen como rutas de diagnostico de
  desarrollo.

## Documentacion principal

- Conexion Supabase: `docs/supabase-setup.md`.
- Auth: `docs/auth-setup.md`.
- Carga de datos: `docs/data-loading.md`.
- Submissions automaticas: `docs/submission-architecture.md`.
- API de ingest: `docs/ingest-api.md`.
- Resultados semanales: `docs/weekly-results.md`.
- Clasificacion de temporada: `docs/season-standings.md`.
- Chat: `docs/chat.md`.
- Admin: `docs/admin.md`, `docs/admin-weeks.md`, `docs/admin-games.md`,
  `docs/admin-seasons.md`.
- Cuestionario de Home: `docs/home-polls.md`.
- Automatizacion: `docs/automation.md`.

## Sigue pendiente

- App local y plugin MAME.
- Storage real.
- Capturas reales.
- App local y plugin MAME como flujo principal de envios.
- Panel completo de usuarios.
- Medallas y bonus.
- Moderacion UI del chat.
- Configuracion de Vercel Cron o equivalente para ejecutar
  `/api/cron/process-schedule`.
- Comentarios del cuestionario, historial de cuestionarios y múltiples
  cuestionarios simultáneos.

## Proximo objetivo recomendado

Hacer una pasada de limpieza de textos debug/redundantes en UI y documentacion,
sin cambiar logica competitiva.
