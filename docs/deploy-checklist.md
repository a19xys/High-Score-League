# Deploy checklist

Checklist reutilizable para publicar una revisión de High Score League en
Vercel con Supabase. No representa por sí solo el estado actual de producción.

## 1. Variables de entorno

Configurar en Vercel, y en local si se prueba antes:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son publicas.
- `SUPABASE_SERVICE_ROLE_KEY` es secreto y solo debe existir en servidor.
- `CRON_SECRET` es secreto y protege `/api/cron/process-schedule`.
- No usar valores reales en `.env.example`, README ni documentacion versionada.

## 2. Supabase

Antes de desplegar, aplicar en orden todas las migraciones de
`supabase/migrations` que no existan todavia en el proyecto remoto:

```text
0001_initial_schema.sql
0002_submission_events.sql
0003_season_memberships_and_results.sql
0004_week_benchmarks.sql
0005_game_metadata.sql
0006_league_chat.sql
0007_league_chat_realtime.sql
0008_submissions_membership_rls.sql
0009_game_instructions.sql
0010_profile_preferences.sql
0011_game_metadata_arrays.sql
0012_optional_week_game.sql
0013_league_chat_message_limits.sql
0014_league_chat_message_editing.sql
0015_hidden_submission_activity.sql
0016_game_week_assets.sql
0017_game_accent_colors.sql
0018_game_download_url.sql
0019_week_benchmark_icon_key.sql
0020_home_polls.sql
0021_home_poll_votes_realtime.sql
0022_home_poll_option_images.sql
0023_profile_bio_max_length.sql
0024_media_uploads.sql
0025_play_time.sql
0026_submission_detected_at_window.sql
```

En el Supabase remoto actual, `0023` y `0024` ya están aplicadas. No deben
repetirse. Esta auditoría no confirma la aplicación remota de `0025` ni `0026`;
comprobar el historial real del entorno antes de ejecutar cualquier migración.

Para la durabilidad competitiva, desplegar en este orden: aplicar `0026`,
publicar después la web/API y finalmente distribuir el launcher actualizado.
No publicar el launcher nuevo contra una API nueva sin haber alineado antes el
índice y la política RLS.

Comprobar despues:

- RLS activado en tablas principales.
- Primer usuario admin creado manualmente en `profiles.is_admin = true`.
- Datos reales minimos: temporada, juegos, semanas y memberships.
- `types/supabase.ts` contiene las tablas y columnas usadas por la app.
- Si el entorno aún no tiene `0023`, ejecutar la consulta previa de bios y
  confirmar que devuelve cero filas con `char_length(bio) > 150`. Si devuelve
  alguna, revisar esos perfiles antes de reintentar; no truncar datos
  automáticamente.
- Si el entorno aún no tiene `0024`, aplicarla después de `0023` y comprobar
  `hsl-public-media`: público, límite 2 MiB y solo `image/webp`; verificar las
  cuatro columnas, constraints y seis policies de avatar/admin. Probar con
  usuario normal y admin antes de desplegar la web.
- En una instalación nueva, `0024` debe preceder al código que consulta sus
  columnas y `0025` debe preceder al código de Playtime. Un rollback web es
  compatible con las columnas nullable de `0024`.
- Si el entorno aún no tiene `0025`, verificar el ledger, los dos agregados, la
  RPC `ingest_play_time_event`, sus grants/RLS y que el propietario pueda leer
  su total mientras otro miembro sólo lo vea con `play_time_public = true`.

## 3. Realtime

Las migraciones añaden estas tablas a `supabase_realtime`:

- `public.league_chat_messages`
- `public.home_poll_votes`

Verificar en Supabase Dashboard que ambas tablas estan en Realtime. El frontend
usa Realtime como via rapida y polling de respaldo cada 10 segundos.

## 4. Supabase Auth

Configurar en Supabase Auth:

- Site URL de produccion.
- Redirect URLs de produccion.
- Redirect URLs de preview/local si se van a usar.
- SMTP propio si se quiere evitar limites del proveedor integrado.
- Email templates si se quiere personalizar confirmacion o recovery.

No inventar URLs: usar las URLs reales generadas por Vercel y el dominio final.

## 5. Cron

El calendario se procesa con:

```text
POST /api/cron/process-schedule
Authorization: Bearer CRON_SECRET
```

Configurar Vercel Cron o un servicio equivalente cada 5 o 10 minutos. Si la
herramienta elegida no permite enviar `Authorization`, resolverlo manualmente
antes de activar cron; no hacer publico el endpoint sin secreto.

Prueba manual:

```powershell
Invoke-WebRequest `
  -Uri "https://TU_DOMINIO/api/cron/process-schedule" `
  -Method POST `
  -Headers @{ Authorization = "Bearer TU_CRON_SECRET" } `
  -UseBasicParsing
```

Tambien probar que sin header devuelve `401`.

## 6. Build local

Antes de pulsar Deploy:

```powershell
npx.cmd tsc --noEmit
npm.cmd run build
```

No hay pasos locales obligatorios adicionales para produccion.

## 7. Rutas post-deploy

Publico sin sesion:

- `/`
- `/login`
- `/register`

Usuario registrado:

- login y logout.
- `/profile`
- `/archive` neutral, `/archive/weeks` y `/archive/seasons`
- redirecciones permanentes desde `/weeks`, `/seasons` y `/season`
- `/weeks/[weekId]`
- `/seasons/[seasonId]`
- `/game`
- chat de liga.
- cuestionario de Home si esta habilitado.

Admin:

- `/admin/games`
- `/admin/seasons`
- `/admin/weeks`
- `/admin/polls`
- crear/editar juego.
- crear/editar temporada.
- crear/editar semana.
- revisar submissions.
- preview y generacion de resultados.
- publicar resultados.
- verificar que un usuario no admin no entra.

Submissions:

- comprobar historiales de 10, 25 y 50 filas, navegación en extremos y retorno
  a página 1 al cambiar orden o tamaño;
- confirmar que intentos, mejor score y scores ocultos se calculan sobre todo el
  conjunto antes de paginar;
- probar `POST /api/submissions/ingest` con token real.
- confirmar que un usuario no unido a la temporada recibe
  `NOT_SEASON_MEMBER`.
- confirmar que una captura anterior a apertura o desde deadline se rechaza;
- confirmar que una captura válida sincronizada tras cierre/publicación se
  acepta y que final stretch fuerza ocultación;
- repetir la misma `duplicateKey` tras cierre y confirmar `duplicate: true`.

Diagnostico:

- `/supabase-test`
- `/real-data-test`

Estas rutas ayudan a revisar despliegue y RLS. Si se mantienen, deben estar
protegidas para admin. No deben quedar accesibles publicamente en produccion.
Tras el despliegue se pueden usar solo con usuario admin para comprobar entorno.
Si se decide retirarlas mas adelante, hacerlo en una tarea posterior.

## 8. Seguridad

- Ningun secreto real en el repositorio.
- `SUPABASE_SERVICE_ROLE_KEY` solo en servidor.
- Endpoints `/api/admin/*` protegidos por perfil admin.
- `/api/cron/process-schedule` protegido por `CRON_SECRET`.
- `/api/submissions/ingest` no acepta `playerId` ni `submittedAt`.
- Chat y cuestionarios no aceptan `authorId`, `messageType` ni `playerId`
  desde cliente.
- Usuarios normales no pueden modificar juegos, temporadas, semanas,
  submissions ajenas ni cuestionarios admin.
- El borrado fisico de cuenta esta deshabilitado. La futura eliminacion de
  cuenta debe implementarse como anonimizacion, conservando la integridad
  historica de competiciones, submissions y resultados.

## 9. Rollback basico

- Mantener el commit estable anterior identificado antes del deploy.
- Si falla el despliegue web, usar rollback de Vercel al deployment anterior.
- Si una migracion falla, detener deploy y no aplicar migraciones posteriores.
- Si el problema es de datos, deshabilitar temporalmente cron y revisar desde
  Supabase SQL Editor.
- Si el problema afecta submissions, pausar los clientes integradores hasta
  validar el endpoint.

## Estado de este checklist

Debe ejecutarse antes de cada despliegue y adaptarse a las migraciones que falten
en el entorno destino. La aplicación remota de `0023` y `0024` está confirmada,
pero no se ha verificado qué SHA web está desplegado actualmente.

## Roadmap no bloqueante para releases actuales

- `PROFILE-ANONYMIZATION-1`: siguiente objetivo; baja por anonimización sin
  borrar actividad histórica.
- `PROFILE-PRESENCE-1`: objetivo posterior; presencia y última actividad con
  heartbeat, expiración y privacidad propios.
- `SUBMISSIONS-SERVER-PAGINATION-1`: evaluar consultas paginadas, conteos e
  índices cuando cargar el conjunto completo deje de ser viable.
- `POSTDEPLOY-MIGRATIONS-1`: consolidar migraciones para instalacion limpia.
  No reescribir la historia de migraciones aplicada a produccion sin estrategia,
  backup y posible ruta separada de fresh install o snapshot.
