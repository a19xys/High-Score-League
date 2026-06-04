# Project status

High Score League esta conectada a Supabase y usa datos reales en la experiencia
normal.

## Estado actual

- Next.js App Router, TypeScript y Tailwind.
- Landing publica para visitantes sin sesion.
- Rutas privadas protegidas con `AccessRequired`.
- Auth real con email/password y perfiles reales.
- Juegos, temporadas, semanas, submissions, leaderboards, `weekly_results`,
  clasificacion de temporada, benchmarks y chat global leen Supabase.
- El panel admin permite gestionar juegos, temporadas, semanas, submissions,
  benchmarks y resultados oficiales. El catálogo de juegos usa metadatos
  múltiples para desarrolladores, editores, perspectivas, temas y géneros.
- `/game` redirige a la semana activa real.
- `/week` y `/leaderboard` redirigen a `/game`.
- `/season` redirige a `/seasons`.
- `lib/mock-data.ts` fue eliminado y ya no existe fallback de producto a datos
  locales.
- `NEXT_PUBLIC_DATA_SOURCE` ya no se usa.

## Supabase

- La migracion principal esta en `supabase/migrations/0001_initial_schema.sql`.
- Las migraciones posteriores preparan submissions automaticas, memberships,
  benchmarks, chat, Realtime, preferencias de perfil y metadatos múltiples de
  juegos.
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
- Automatizacion: `docs/automation.md`.

## Sigue pendiente

- App local y plugin MAME.
- Storage real.
- Capturas reales.
- Subida manual real desde `/submit`.
- Panel completo de usuarios.
- Medallas y bonus.
- Moderacion UI del chat.
- Configuracion de Vercel Cron o equivalente para ejecutar
  `/api/cron/process-schedule`.

## Proximo objetivo recomendado

Hacer una pasada de limpieza de textos debug/redundantes en UI y documentacion,
sin cambiar logica competitiva.
