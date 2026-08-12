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
0027_profile_anonymization.sql
0028_player_presence.sql
0029_profile_privacy_defaults.sql
0030_week_benchmark_images.sql
```

En el Supabase remoto actual, `0023` y `0024` ya están aplicadas. No deben
repetirse. `0026_submission_detected_at_window.sql` también existe y está
confirmada como aplicada remotamente: no modificarla, renombrarla, duplicarla,
reaplicarla ni volver a pedir su aplicación. `0027_profile_anonymization.sql`
también está confirmada como aplicada remotamente y no debe reaplicarse.

Para una instalación nueva de Anonymization, el orden es: verificar estado de
schema → aplicar `0027` → verificar → desplegar web compatible → QA con cuenta
desechable. Antes de escribir o ejecutar SQL adicional, usar
`supabase/preflight/0027_profile_anonymization.sql`, que es de solo lectura y
comprueba especialmente las dependencias Playtime de `0025` y el índice de
`0026`.

`0030_week_benchmark_images.sql` es la migración nueva de esta revisión y está
pendiente de aplicación remota. Ejecutar antes su preflight de solo lectura
`supabase/preflight/0030_week_benchmark_images.sql`. El orden es: verificar el
schema y bucket → aplicar `0030` → verificar columna, constraint y tres policies
→ desplegar la web compatible → QA de crear/reemplazar/quitar/eliminar con un
benchmark desechable. No crear migraciones posteriores a `0030` salvo un nuevo
conflicto real.

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
- Antes de `0027`, confirmar que todas las filas del preflight con
  `required = true` tienen `present = true`, que `0026` figura en el historial, que
  no hay usernames en el namespace `deleted_` y que se conoce el recuento de
  administradores activos. `public.chat_messages` puede devolver
  `required = false, present = false`: es legacy y no bloquea la migración.
  Detenerse ante cualquier otra discrepancia.
- Después de `0027`, verificar `profiles.anonymized_at`, la tabla privada de
  usernames retirados, la RPC `anonymize_profile_account`, las funciones
  sustituidas y todas las policies activas. No desplegar la web compatible si la
  migración no quedó confirmada.
- Antes de `0030`, confirmar que `week_benchmarks` y `hsl-public-media` existen,
  que `image_storage_path` aún no existe y registrar los conteos de benchmarks y
  `icon_key` legacy. Después, comprobar el patrón
  `benchmarks/icons/<UUID>.webp`, las policies admin de `INSERT/SELECT/DELETE` y
  el fallback `REF` para filas sin imagen.

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
- La anonimización exige username exacto y confirmación, bloquea al último
  administrador y no acepta IDs de identidad enviados por el cliente.
- Tras una baja, probar que el tombstone conserva submissions, resultados,
  memberships, chat y votos, pero no puede autenticarse, recrear perfil, votar,
  enviar puntuaciones, escribir chat, unirse a temporadas ni ingerir Playtime.
- Confirmar que se borraron los tres datasets Playtime, el avatar administrado y
  la metadata personal/técnica prevista, sin tocar imágenes de juegos, polls ni
  texto libre histórico.

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
en el entorno destino. La aplicación remota de `0023`, `0024`,
`0026_submission_detected_at_window.sql` y `0027_profile_anonymization.sql` está
confirmada. No se ha verificado qué SHA web está desplegado actualmente.

Para `PROFILE-PRESENCE-1` el orden es estricto: (1) aplicar
`0028_player_presence.sql`, (2) aplicar `0029_profile_privacy_defaults.sql`,
(3) desplegar web/API y (4) distribuir el launcher. Antes de los pasos 3 y 4,
verificar defaults nuevos `presence_public=true` y `play_time_public=true`,
ausencia de backfill sobre filas existentes, RLS sin lectura general, cleanup
al privatizar/tombstone y RPCs reservadas a `service_role`. Si `0028` aún no
está aplicada, Presence debe fallar de forma silenciosa sin bloquear web,
launcher, Playtime ni Competition.

Para `WEB-WEEK-BENCHMARK-PROFILE-POLISH-2`, `0030` sigue pendiente: no desplegar
la web que selecciona `week_benchmarks.image_storage_path` hasta aplicarla y
verificarla. La migración es aditiva y conserva `icon_key` para permitir un
rollback temporal a la web anterior.

## Roadmap no bloqueante para releases actuales

- `PROFILE-ANONYMIZATION-1`: operativa en código/schema con 0027 aplicada. El QA
  destructivo exhaustivo con cuenta desechable quedó diferido por decisión del
  usuario.
- `PROFILE-PRESENCE-1`: implementada en código/schema; pendiente de aplicar
  `0028`, después `0029`, y desplegar en el orden anterior. No incluye última
  actividad por diseño.
- `SUBMISSIONS-SERVER-PAGINATION-1`: evaluar consultas paginadas, conteos e
  índices cuando cargar el conjunto completo deje de ser viable.
- `POSTDEPLOY-MIGRATIONS-1`: consolidar migraciones para instalacion limpia.
  No reescribir la historia de migraciones aplicada a produccion sin estrategia,
  backup y posible ruta separada de fresh install o snapshot.
