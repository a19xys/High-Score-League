# Project status

High Score League esta en fase mock avanzada.

## Estado actual

- La interfaz principal esta montada con Next.js App Router, TypeScript y
  Tailwind CSS.
- Las paginas principales siguen usando `lib/mock-data.ts`, salvo `/seasons`,
  `/seasons/[seasonId]`, `/weeks`, `/weeks/[weekId]` y `/game`, que pueden leer Supabase si
  `NEXT_PUBLIC_DATA_SOURCE=supabase`.
- El mockup incluye juego actual, semanas, temporadas, perfiles, leaderboards,
  tema claro/oscuro, subida provisional y administracion mock. La portada ya
  puede usar datos reales y chat real en modo Supabase.
- No se debe sustituir el mockup por datos reales hasta decidir el flujo de
  conexion.

## Supabase

- Supabase ya esta conectado mediante clientes de navegador y servidor.
- La prueba aislada vive en `/supabase-test`.
- La prueba de datos de dominio vive en `/real-data-test`.
- `/seasons`, `/seasons/[seasonId]`, `/weeks`, `/weeks/[weekId]` y `/game`
  pueden leer datos reales con fallback mock.
- `/weeks/[weekId]` y `/game` pueden calcular leaderboard semanal real de solo
  lectura desde `submissions` visibles.
- `POST /api/submissions/ingest` existe como endpoint mínimo autenticado para
  crear submissions automáticas sin service role.
- `season_memberships` permite registrar jugadores por temporada.
- `POST /api/admin/weeks/[weekId]/weekly-results` permite preview y generación
  oficial de resultados semanales para admins usando miembros elegibles por
  fecha de corte de la semana.
- `week_benchmarks` permite mostrar referencias visuales en leaderboards sin
  afectar submissions, puntos ni resultados oficiales.
- `/seasons/[seasonId]` calcula clasificacion y podio reales desde
  `weekly_results`, incluyendo miembros activos con 0 puntos.
- `/profile` muestra centro admin real solo para usuarios con `is_admin = true`.
- `/admin/weeks` y `/admin/weeks/[weekId]` permiten gestionar semanas,
  submissions y resultados oficiales sin SQL manual.
- `/admin/weeks/new` y `/admin/weeks/[weekId]/edit` permiten crear semanas,
  editar sus metadatos principales y gestionar benchmarks básicos.
- Las semanas usan estado derivado por fechas: apertura (`public_start_at`),
  tramo final opcional (`public_freeze_at`) y cierre (`final_deadline_at`).
  `reveal_at` queda como campo legacy.
- Crear o editar una semana ejecuta una reconciliacion server-side: sincroniza
  estado interno, recalcula `is_hidden` de submissions validas y retira
  `weekly_results` si la semana se reabre.
- Las temporadas `completed` bloquean cambios normales en sus semanas,
  benchmarks y generacion manual de resultados.
- `POST /api/cron/process-schedule` sincroniza estados internos de semanas y
  temporadas por fechas, reutiliza la reconciliacion de semanas, genera
  `weekly_results` al cierre y marca semanas como `published`.
- `/admin/games` permite gestionar el catálogo real de juegos: listar, buscar,
  crear y editar.
- `/admin/seasons` permite gestionar temporadas reales: listar, buscar, crear y
  editar.
- `/` lee semana activa, temporada activa, leaderboard y chat real cuando
  `NEXT_PUBLIC_DATA_SOURCE=supabase`.
- `league_chat_messages` guarda el chat global real de la liga con mensajes
  `user` y `system`.
- `POST /api/chat/messages` permite enviar mensajes autenticados sin aceptar
  `authorId` ni `messageType` desde cliente.
- El chat usa Supabase Realtime para recibir inserts sin recargar la página y
  polling de respaldo cada 10 segundos.
- La pagina temporal `/seasons-real` queda como comparativa visual.
- La migracion principal esta en
  `supabase/migrations/0001_initial_schema.sql`.
- La migracion `supabase/migrations/0002_submission_events.sql` prepara
  `submissions` para eventos automaticos desde MAME/app local.
- El seed de desarrollo esta en `supabase/seed-dev.sql`.
- La documentacion del modelo esta en `docs/database.md`.
- La documentacion de Storage esta en `docs/supabase-storage.md`.
- La documentacion de carga de datos esta en `docs/data-loading.md`.
- La documentacion de arquitectura de submissions esta en
  `docs/submission-architecture.md`.
- La guia para insertar submissions de prueba esta en
  `docs/test-submissions.md`.
- La documentacion del endpoint de ingestion esta en `docs/ingest-api.md`.
- La documentacion de resultados oficiales esta en `docs/weekly-results.md`.
- La documentacion de benchmarks visuales esta en `docs/week-benchmarks.md`.
- La documentacion de clasificacion de temporada esta en
  `docs/season-standings.md`.
- La documentacion del panel admin minimo esta en `docs/admin.md`.
- La documentacion de administracion de semanas esta en
  `docs/admin-weeks.md`.
- La documentacion de administracion de juegos esta en `docs/admin-games.md`.
- La documentacion de administracion de temporadas esta en
  `docs/admin-seasons.md`.
- La documentacion de automatizacion de calendario esta en
  `docs/automation.md`.
- La documentacion del chat global esta en `docs/chat.md`.

## Auth

- Auth minimo esta implementado con email y password.
- `/register` crea cuenta, guarda `username` e `initials` en `user_metadata` y
  crea perfil si hay sesion inmediata.
- `/login` inicia sesion y asegura perfil desde un unico helper idempotente.
- `/profile` es el centro unico de perfil real: muestra sesion, email, perfil,
  formulario inline si falta perfil y edicion de username/siglas.
- `/profile/setup` queda como ruta legacy y no forma parte del flujo normal.
- El borrado de cuentas de prueba existe en `/profile` mediante route handler de
  servidor y `SUPABASE_SERVICE_ROLE_KEY`.
- El primer admin se crea manualmente en Supabase SQL Editor.

## Sigue pendiente

- Implementar plugin MAME y app local.
- Conectar capturas reales a Storage.
- Decidir politicas publicas o flujo autenticado para lectura.
- Sustitucion parcial y progresiva de mock data.
- Subida manual real desde `/submit`.
- Panel completo de usuarios.
- Creación avanzada de semanas con manuales, descargas y configuración MAME.
- Storage para imágenes, manuales y descargas.
- Medallas y bonus.
- Moderación UI del chat.
- Integracion con MAME.
- Configuracion de Vercel Cron o equivalente para ejecutar
  `/api/cron/process-schedule`.

## Proximo objetivo recomendado

El siguiente paso sera probar el flujo admin completo con datos reales: crear
temporada, crear juego, crear semana, recibir submissions, cerrar semana,
generar resultados y publicar.
