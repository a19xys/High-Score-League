# Deploy checklist

Checklist reutilizable para publicar una revisión de High Score League en
Vercel con Supabase. No representa por sí solo el estado actual de producción.

## 1. Variables de entorno

Configurar en Vercel, y en local si se prueba antes:

```text
NEXT_PUBLIC_SITE_URL=https://highscoreleague.com
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
HSL_R2_ACCOUNT_ID=
HSL_R2_BUCKET=
HSL_R2_ACCESS_KEY_ID=
HSL_R2_SECRET_ACCESS_KEY=
HSL_R2_JURISDICTION=default
```

- `NEXT_PUBLIC_SITE_URL` es pública y en Production debe ser exactamente
  `https://highscoreleague.com`.
- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son publicas.
- `SUPABASE_SERVICE_ROLE_KEY` es secreto y solo debe existir en servidor.
- `CRON_SECRET` es secreto y protege `/api/cron/process-schedule`.
- Las cinco variables `HSL_R2_*` son sólo de servidor. El token debe ser
  `Object Read only` y estar limitado al bucket privado de packs; no habilitar
  `r2.dev`, acceso público ni CORS. Mantener cualquier credencial read+write de
  publicación separada de Vercel.
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
0031_launcher_packs.sql
0032_profile_bootstrap_rls.sql
0034_competition_integrity.sql
```

`0033` quedó retirada históricamente. No crearla ni reutilizar su identidad.

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
benchmark desechable.

### Procedimiento para un entorno nuevo

Antes de desplegar el endpoint de packs en un entorno nuevo: verificar el estado
real de migraciones, ejecutar el preflight de sólo lectura
`supabase/preflight/0031_launcher_packs.sql`, detenerse ante cualquier drift,
aplicar `0031`, comprobar constraints/triggers/índice parcial/RLS y sólo después
configurar R2 y desplegar. `0030` continúa con su estado histórico pendiente; no
se deduce su aplicación por la mera presencia del archivo.

`0032_profile_bootstrap_rls.sql` forma parte del inventario actual. Antes de
aplicarla en un entorno nuevo, ejecutar
`supabase/preflight/0032_profile_bootstrap_rls.sql`, comprobar sus dependencias y
detenerse ante cualquier drift. Este checklist no afirma cuál es el estado
remoto de `0032` en HSL.

`0034_competition_integrity.sql` está implementada y endurecida localmente pero
NO aplicada en producción. Antes de cualquier web compatible, ejecutar el preflight
SELECT-only `supabase/preflight/0034_competition_integrity.sql`, revisar drift y
aplicar/verificar la migration en una operación autorizada. Si la web nueva se
despliega antes por error, ingest debe responder 503 y conservar pending, nunca
aceptar el evento como legacy.

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
- Antes de `0031`, confirmar que `weeks.id` es UUID, existen `public.is_admin()`
  y `public.set_updated_at()`, no existe ya `launcher_packs` y `weeks` no contiene
  una columna improvisada `launcher_pack_id`. Después, verificar object key
  generated, límites/hash/status, lifecycle e inmutabilidad, draft borrable,
  publicados no borrables, único published por semana y RLS sin lectura normal.
- Crear después un bucket R2 privado y un token Object Read only limitado al
  bucket; configurar las cinco variables server-side y probar con un pack
  autorizado sólo tras desplegar. No reutilizar una credencial de escritura.
- Antes de `0034`, inventariar las policies/grants de `submissions`, confirmar
  `0031`, el índice de duplicate de `0026`, `is_admin()` y `set_updated_at()`.
  Después, verificar manifest, policy privada, FK pack/week, fingerprint
  DB-owned, `frozen_at`, row locks, candidate index, guards de INSERT/UPDATE,
  ausencia de INSERT/DELETE autenticado y UPDATE sólo para
  `is_valid`/`is_hidden`.
- Probar en Supabase local o staging: JWT normal → INSERT directo falla;
  service role + row normalizada → pasa; Protected incompleta → DB guard falla;
  legacy sin policy → sólo backend server-side. No usar producción como banco
  de pruebas.
- Probar dos sesiones concurrentes sobre una policy unfrozen. Si INSERT gana,
  debe congelar A y UPDATE A→B debe fallar. Si UPDATE gana, el INSERT con
  fingerprint A debe fallar como authority changed/retryable. Borrar después
  todas las submissions fixture no puede permitir UPDATE ni DELETE de policy.
- Verificar status de packs: policy nueva/retarget a disabled falla; published
  target unfrozen no puede deshabilitarse; frozen sí permite disabled y un
  duplicate exacto continúa devolviendo éxito.

### Estado conocido de producción HSL

La migración `0031_launcher_packs.sql` está aplicada y el catálogo privado
`launcher_packs` está operativo. El bucket R2 privado, la credencial web
`Object Read only`, las variables de servidor y el endpoint de descarga están
configurados y desplegados. El pack `space-invaders-s1-w1-r1` está publicado y
la importación E2E real se completó correctamente.

Este estado operativo no sustituye el procedimiento anterior para una
instalación nueva, una restauración completa o un entorno distinto. No se
incluyen credenciales, hashes, identificadores de cuenta ni URLs firmadas.

## 3. Realtime

Las migraciones añaden estas tablas a `supabase_realtime`:

- `public.league_chat_messages`
- `public.home_poll_votes`

Verificar en Supabase Dashboard que ambas tablas estan en Realtime. El frontend
usa Realtime como via rapida y polling de respaldo cada 10 segundos.

## 4. Supabase Auth

Configurar en Supabase Auth:

- Site URL: `https://highscoreleague.com`.
- Redirect URL: `https://highscoreleague.com/auth/recovery/start`.
- Redirect URL legacy: `https://high-score-league.vercel.app/auth/recovery/start`.
- Redirect URL local: `http://localhost:3000/auth/recovery/start`.
- Email templates si se quiere personalizar confirmacion o recovery.

El estado actual usa el proveedor integrado de email de Supabase, con
confirmación y recovery operativos y límites aceptados para esta fase. Custom
SMTP no está configurado ni bloquea el despliegue; mantenerlo como recomendación
futura si la escala exige otros límites.

En Vercel, confirmar además este contrato de dominios:

- `https://highscoreleague.com`: dominio canónico de Production;
- `https://www.highscoreleague.com`: redirect de Vercel al apex;
- `https://high-score-league.vercel.app`: alias legacy directo, sin redirect
  global, necesario para compatibilidad del launcher `0.3.0`.

No añadir redirects de hostname en middleware o Next config. Las sesiones no se
comparten ni migran entre el apex y el host `.vercel.app`.

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
- para Protected, comprobar missing/v1/developer evidence y todos los mismatch
  canónicos como 409 terminal; configuración/policy/pack no disponibles deben
  ser 5xx retryable;
- confirmar retry exacto con pack `disabled`, sin imponer antigüedad máxima;
- confirmar que el INSERT REST directo con JWT autenticado queda revocado.

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
- Credenciales R2, bearer HSL y URLs presigned sólo en servidor/transporte; no
  registrarlas ni devolver object keys. El bucket de packs permanece privado.
- Endpoints `/api/admin/*` protegidos por perfil admin.
- Recovery usa el storage namespace exclusivo `hsl-recovery-auth`, con cookies
  `Path=/reset-password`; no comparte ni sustituye la sesión Auth normal.
- Las fronteras web sensibles verifican el usuario normal con `auth.getUser()`;
  el middleware y la navegación no administran ni interpretan Recovery.
- Los endpoints Bearer del launcher conservan su autenticación canónica mediante
  `auth.getUser()` y su taxonomía de errores existente.
- `/api/cron/process-schedule` protegido por `CRON_SECRET`.
- `/api/submissions/ingest` no acepta `playerId` ni `submittedAt`.
- `/api/submissions/ingest` usa la sesión sólo para identidad/perfil y mantiene
  `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en la frontera server-side.
- `authenticated`, incluido admin, no puede insertar directamente en
  `public.submissions`; futuras importaciones admin requieren backend explícito.
- Los admins autenticados sólo actualizan `is_valid` e `is_hidden` y no pueden
  borrar submissions ni modificar identidad Protected canónica.
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
`0026_submission_detected_at_window.sql`, `0027_profile_anonymization.sql` y
`0031_launcher_packs.sql` está confirmada. El 24 de agosto de 2026 el health de
Production acreditó el build compatible `eb32837a1cac`; r1 seguía published y
la ausencia de tabla/columnas confirmó que `0034` no estaba aplicada. La
operación E2E se detuvo antes de toda mutación por falta de canal SQL aislado y
credencial R2 write. Véase `docs/competition-integrity-e2e-1.md`. No se afirma
aquí el estado remoto de `0032`.

Recovery se limita a una sesión Supabase aislada en la frontera web del
navegador. No requiere aplicar SQL ni probar Data API o Storage. Después del
deploy, usar un enlace nuevo y confirmar: GET anti-prefetch, POST Continuar a
`/reset-password`, navegación normal desconectada, retries de password débil y
misma password, cancelación local sólo Recovery, update válido, logout global y
login manual. Repetir desde un navegador con sesión HSL previa para comprobar
que verify no sobrescribe su cookie normal.

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

Para `WEB-PACK-DISTRIBUTION-R2-1`, la operación de producción HSL ya está
completada: `0031`, el catálogo, R2 privado, la credencial read-only, las
variables, el endpoint, el pack real y el E2E están operativos. En un entorno
nuevo se conserva el orden reutilizable: preflight → migración → verificación
RLS/constraints → R2 privado → env → deploy → alta/publicación de un pack
autorizado → endpoint/HEAD/presign → importación desde launcher.

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
