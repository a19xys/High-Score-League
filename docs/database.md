# High Score League database model

Este documento describe el esquema actual de Supabase. La app usa estas tablas
como fuente real; las migraciones viven en `supabase/migrations/`.

## Tablas principales

### profiles

Representa a los jugadores. Cada fila está asociada a `auth.users(id)` y guarda
datos públicos de liga: `username`, siglas, avatar, bio pública, visibilidad de
Playtime e indicador `is_admin`.

La identidad visible principal son las siglas de 3 caracteres. Debajo se muestra
el username con `@`, por ejemplo `LVC` y `@lauravc`.

`username` debe cumplir `^[a-z][a-z0-9_]{2,19}$`: solo minúsculas, números y
guion bajo; debe empezar por letra; longitud de 3 a 20 caracteres. Ejemplos
válidos: `lauravc`, `alex_87`, `mario123`.

`initials` debe cumplir `^[A-Z0-9]{3}$`: exactamente 3 caracteres, letras A-Z o
números. El frontend debe transformar las siglas a mayúsculas antes de guardar.
Ejemplos válidos: `LVC`, `AAA`, `P1X`.

`username` e `initials` tienen índices únicos normalizados para evitar
duplicados por mayúsculas/minúsculas. `username` usa `lower(trim(username))` y
`initials` usa `upper(trim(initials))`.

La bandera `is_admin` se usa para políticas RLS de gestión. El primer admin debe
crearse manualmente desde SQL Dashboard o con service role, porque un usuario
normal no puede promocionarse a si mismo mediante las politicas iniciales.

Desde `0010_profile_preferences.sql` incluye `bio` y `track_play_time`:

- `bio`: descripción pública opcional del jugador. Puede ser `null`, pero si
  existe no puede quedar en blanco. Desde `0023_profile_bio_max_length.sql`
  tampoco puede superar 150 caracteres (`char_length(bio) <= 150`). La
  migración comprueba primero los datos existentes y falla de forma explícita
  si encuentra valores incompatibles; nunca los trunca.
- `track_play_time`: columna legacy; ya no gobierna el registro identificado de
  Playtime ni se migra a la preferencia pública.

`0025_play_time.sql` añadió `play_time_public` con el default histórico
`false`. `0029_profile_privacy_defaults.sql` cambia a `true` el default para
perfiles nuevos, sin reescribir filas existentes. El campo controla la
visibilidad del agregado de Playtime para otros jugadores y el propietario
conserva siempre la lectura. `track_play_time` no gobierna este control ni el
registro identificado.

`avatar_url` se conserva como compatibilidad. `0024_media_uploads.sql` añade
`avatar_storage_path`; el resolver prefiere el objeto de `hsl-public-media` y
usa la URL antigua cuando el path es null. La subida se procesa como WebP en el
navegador. No hay Storage privado de capturas en esta fase.

`0025_play_time.sql` añade el ledger idempotente `play_time_events`, los
agregados `player_game_play_time` y `player_play_time_totals`, y la RPC
transaccional `ingest_play_time_event`. El jugador procede de `auth.uid()` y el
juego se resuelve desde `weeks.game_id`; Playtime no depende de membership ni
del estado competitivo de la semana. RLS permite leer los agregados al dueño,
al administrador o a otros usuarios autenticados solo si
`play_time_public = true`.

El endpoint `POST /api/launcher/playtime/ingest` llama a la RPC con la sesión
autenticada. Los UUID de evento hacen los reintentos idempotentes. Playtime no
representa presencia, última actividad, ranking ni submissions; no debe usarse
para inferir ninguno de esos estados.

### seasons

Representa una temporada completa, por ejemplo `Temporada I`. Tiene `slug`,
`version`, fechas opcionales y estado `draft`, `active` o `completed`.

El panel admin permite crear, editar y borrar temporadas cuando el borrado es
seguro. Crear una temporada no crea semanas automáticamente.

### games

Catálogo de juegos arcade. No depende de una temporada concreta, de forma que un
juego pueda reutilizarse en futuras temporadas.

Desde `0011_game_metadata_arrays.sql`, los metadatos visibles principales son:

- `developers text[]`;
- `publishers text[]`;
- `perspectives text[]`;
- `themes text[]`;
- `genres text[]`.

La migración hace backfill desde las columnas legacy `developer`, `publisher` y
`genre` si tenían valor. Las columnas legacy se conservan por compatibilidad,
pero la UI y las lecturas de runtime usan las columnas nuevas como fuente de
verdad.

`control_type` y `difficulty` dejan de usarse en la UI.

Desde `0009_game_instructions.sql` incluye instrucciones base y manual externo:

- `instructions`: instrucciones base del juego;
- `manual_url`: enlace externo opcional al manual.

`manual_url` puede ser `null`, pero si existe debe empezar por `http://` o
`https://`. No hay Storage ni subida de manuales todavía.

### weeks

Representa una semana competitiva dentro de una temporada. Relaciona
`season_id` con `game_id` cuando el juego ya está asignado, define
`week_number`, fechas de apertura/cierre y estado `draft`, `active`, `frozen`,
`closed` o `published`.

Desde `0012_optional_week_game.sql`, `game_id` puede ser `null`. Esto permite
crear semanas futuras sin revelar ni inventar un juego real placeholder. La UI
pública muestra esas semanas como `Por anunciar`; el panel admin las muestra
como `Sin juego asignado`. Una semana no debe abrirse ni aceptar submissions si
no tiene juego asignado.

La restricción `unique(season_id, week_number)` evita dos semanas con el mismo
número dentro de una misma temporada.

`weeks.rules_summary` se mantiene como campo legacy, pero la app lo interpreta
como override opcional de instrucciones de semana. Si está vacío, el detalle de
semana usa `games.instructions`; si tampoco existe, muestra un estado vacío.

### submissions

Representa cada puntuación subida por un jugador. Guarda la semana, jugador,
puntuación, metadatos opcionales de captura, comentario opcional y flags de
control:

- `is_hidden`: permite ocultar puntuaciones hasta publicar resultados.
- `is_valid`: permite invalidar una puntuación desde administración.
- `source`: origen de la submission (`web`, `mame_memory`, `mame_plugin`,
  `local_app` o `admin_import`).
- `detected_at`: momento competitivo canónico declarado por el cliente.
- `submitted_at`: momento recibido por la web; lo fuerza el servidor y no
  decide la ventana competitiva.
- `rom_name`, `mame_version`, `client_version`: contexto técnico del evento.
- `raw_event`: payload original para depuración y auditoría.
- `duplicate_key`: clave de idempotencia para reintentos.
- `screenshot_path`: ruta opcional de captura en Storage.
- `screenshot_mime_type`: tipo MIME informado para la captura optimizada.
- `screenshot_size_bytes`: tamaño final de la captura en bytes, si se conoce.

Las capturas son opcionales desde `0002_submission_events.sql`. El flujo web
vigente de integración es `POST /api/submissions/ingest`; `/submit` queda como
herramienta legacy/interna para admins y su botón de envío está deshabilitado.

La API permite registrar puntuaciones aunque no superen el récord personal. La
mejor puntuación semanal de cada jugador se calcula desde esta tabla, mientras
el número de subidas cuenta todas las submissions válidas de la semana. El
resultado final publicado queda separado en `weekly_results`.

### weekly_results

Representa resultados finales publicados por semana. Guarda una fila estable por
jugador y semana con `final_score`, `rank`, `league_points` y flags para primer,
segundo o tercer puesto.

La clasificación de temporada se agrega desde esta tabla sumando puntos y
contando primeros, segundos y terceros puestos.

Desde `0003_season_memberships_and_results.sql`, estos resultados se calculan
contra los miembros activos de la temporada. Los jugadores sin submission válida
en una semana no reciben fila y suman 0 puntos.

### season_memberships

Representa qué jugadores participan en una temporada. Permite que una temporada
tenga N jugadores y que un usuario se una a una temporada activa.

Campos principales:

- `season_id`
- `player_id`
- `status`: `active` o `left`
- `joined_at`

La pareja `season_id, player_id` es única. Por ahora se permite unirse a una
temporada activa aunque ya haya empezado; el jugador entra con 0 puntos previos.

### week_benchmarks

Representa referencias visuales de puntuación para una semana, como
`Puntuación media`, `Puntuación avanzada` o `Puntuación experta`.

No son submissions reales: no tienen jugador, no cuentan para puntos, no generan
`weekly_results`, no afectan a `M` y no aparecen en historial de envíos.

Campos principales:

- `week_id`
- `label`
- `score`
- `description`
- `icon_key`
- `sort_order`
- `is_active`

`icon_key` solo admite `speedometer_1`, `speedometer_2` o `speedometer_3`.

### league_chat_messages

Representa el chat global real de la liga en la portada. Se crea en
`0006_league_chat.sql`.

Campos principales:

- `message_type`: `user` o `system`.
- `author_id`: perfil autor para mensajes `user`; `null` para mensajes
  `system`.
- `content`: texto del mensaje, máximo 65.536 caracteres.
- `created_at`.
- `edited_at`: fecha de última edición, `null` si el mensaje no se ha editado.

El chat conserva solo los 75 mensajes más nuevos mediante trigger. Al crear un
perfil nuevo, otro trigger inserta un mensaje `system` con el username.
Los usuarios autenticados pueden editar únicamente su último mensaje propio de
tipo `user` durante 15 minutos; la base de datos marca `edited_at` al actualizar
el contenido.

La secuencia local inicial contiene `chat_messages` como preparación histórica,
pero algunos entornos remotos la omiten porque nunca tuvo un consumidor real.
Es una relación legacy opcional: `0027` protege sus policies si existe y la
ignora de forma explícita si está ausente. El chat conectado de la home usa
`league_chat_messages`.

### home_polls, home_poll_options y home_poll_votes

Representan el cuestionario único de Home. Se crean en
`0020_home_polls.sql`; `0021_home_poll_votes_realtime.sql` añade
`home_poll_votes` a la publicación Realtime.

`home_polls` es singleton mediante `singleton_key boolean not null default true
unique check (singleton_key)`, por lo que solo puede existir un cuestionario. Sus
campos principales son:

- `question`
- `enabled`
- `closes_at`
- `created_at`
- `updated_at`

`home_poll_options` guarda las respuestas posibles, con `label` no vacío,
máximo 80 caracteres y `sort_order >= 0`.

Desde `0022_home_poll_option_images.sql`, cada opción puede guardar
`image_url` opcional. Si existe, debe empezar por `http://` o `https://`. La app
valida que un cuestionario use imágenes en todas sus opciones o en ninguna, para
evitar tarjetas mezcladas. Si no hay imágenes, Home no reserva espacio ni
muestra placeholder.

`0024_media_uploads.sql` añade `home_poll_options.image_storage_path` y paths
equivalentes para avatar, header y logo de juego. También crea/configura el
bucket público `hsl-public-media`, sus policies y constraints de prefijo/UUID.
Los campos URL anteriores no se eliminan ni se migran automáticamente.

`home_poll_votes` guarda un voto por usuario y cuestionario con
`unique(poll_id, player_id)`. La FK compuesta `(option_id, poll_id)` garantiza
que la opción votada pertenece al mismo cuestionario.

El panel admin `/admin/polls` permite editar pregunta, cierre, estado, opciones,
imágenes administradas o legacy, estadísticas agregadas y reinicio del
cuestionario.
La tarjeta de la Home privada permite votar, cambiar voto y ver resultados
agregados tras votar, con Realtime y polling de respaldo cada 10 segundos.
Comentarios e historial de cuestionarios quedan para una fase posterior.

## Empates de temporada

La clasificación de temporada usa estos criterios competitivos, en este orden:

1. Puntos totales.
2. Primeros puestos.
3. Segundos puestos.
4. Terceros puestos.

Si dos o más jugadores empatan en todos esos criterios, comparten posición. El
ranking es de competición, por ejemplo `1, 2, 2, 4`, no ranking denso. No se
usa `username`, `initials` ni otro campo de identidad como desempate
competitivo oculto.

Para que la tabla sea estable visualmente, los jugadores empatados pueden
ordenarse por `username` o `initials`, pero ese orden no rompe el empate.

El movimiento de posición compara la posición competitiva compartida actual
contra la posición competitiva compartida de la semana anterior.

La clasificación y el movimiento se calculan desde `weekly_results`. La creación
o regeneración de esas filas sigue siendo una acción manual del admin al
publicar una semana.

## Relaciones

- `profiles.id` referencia `auth.users.id`.
- `weeks.season_id` referencia `seasons.id`.
- `weeks.game_id` referencia `games.id` cuando tiene valor; puede ser `null`
  para semanas futuras o todavía no anunciadas.
- `submissions.week_id` referencia `weeks.id`.
- `submissions.player_id` referencia `profiles.id`.
- `weekly_results.week_id` referencia `weeks.id`.
- `weekly_results.player_id` referencia `profiles.id`.
- Si existe la tabla legacy opcional, `chat_messages.player_id` referencia
  `profiles.id`.
- `league_chat_messages.author_id` referencia `profiles.id` con
  `on delete set null`.
- `season_memberships.season_id` referencia `seasons.id`.
- `season_memberships.player_id` referencia `profiles.id`.
- `week_benchmarks.week_id` referencia `weeks.id`.
- `home_poll_options.poll_id` referencia `home_polls.id`.
- `home_poll_votes.poll_id` referencia `home_polls.id`.
- `home_poll_votes.option_id, poll_id` referencia `home_poll_options.id,
  poll_id`.
- `home_poll_votes.player_id` referencia `auth.users.id`.

## Flujo semanal de datos

1. Un admin crea una temporada, juegos y semanas.
2. Una semana pasa a `active`.
3. Un cliente autenticado envía eventos a `POST /api/submissions/ingest`, que
   deriva el jugador de la sesión y crea filas en `submissions`.
4. Si `detected_at` está entre apertura y freeze, la submission puede ser
   visible u oculta.
5. Si `detected_at` está entre freeze y deadline, debe entrar oculta.
6. Una recepción posterior al cierre sigue siendo válida si la detección fue
   anterior al deadline; antes de apertura o desde deadline se rechaza.
7. Mientras `is_hidden = true`, una submission solo la ve su jugador y admins.
8. Al cerrar la semana, el admin revisa submissions y puede marcar errores con
   `is_valid = false`.
9. Al publicar, el admin crea filas en `weekly_results`.
10. La clasificación general de temporada se lee agregando `weekly_results`.
11. La portada lee los últimos 75 mensajes desde `league_chat_messages`.

Las fechas de cierre y revelación existen como datos de la semana. En la UI
principal solo se muestra el rango competitivo, por ejemplo
`18–24 de mayo de 2026`; cierre y revelación no se muestran como tarjetas
independientes por ahora.

## Zona horaria de competición

La liga usa una zona horaria explícita de competición. En esta fase, la
referencia es `Europe/Madrid`.

Las fechas guardadas en Supabase son `timestamptz`. Al crear semanas reales, los
timestamps deben incluir zona horaria explícita y no ser fechas ambiguas. Ejemplos:

- `2026-05-18T00:00:00+02:00`
- `2026-05-22T23:59:00+02:00`
- `2026-05-24T23:59:00+02:00`
- `2026-05-25T00:00:00+02:00`

La interfaz formatea rangos y horas en `Europe/Madrid`. Los tiempos relativos,
como `hace 4 días`, incluyen la fecha/hora exacta en el atributo HTML `title`
para poder verla al pasar el ratón.

## Uso actual

Las tablas centrales son:

- `profiles` para jugadores y admins.
- `seasons`, `games`, `weeks` para calendario competitivo.
- `submissions` para el historial de subidas.
- `weekly_results` para resultados publicados y clasificación estable.
- `league_chat_messages` para el chat global real de la liga.

En la interfaz, `positionChange` compara la clasificación actual con la anterior
excluyendo la última semana con resultados oficiales.

## RLS

Todas las tablas principales tienen Row Level Security activado.

- `profiles`: usuarios autenticados pueden leer perfiles; cada usuario puede
  insertar o actualizar su propio perfil sin poder activar `is_admin`; admins
  pueden gestionar perfiles. El avatar usa `avatar_storage_path` como referencia
  administrada y `avatar_url` como compatibilidad.
- `seasons`, `games`, `weeks`: usuarios autenticados pueden leer; solo admins
  pueden insertar, actualizar o borrar.
- `submissions`: usuarios autenticados pueden leer submissions visibles y
  válidas; cada jugador puede leer las propias aunque estén ocultas; el insert
  propio exige membership activa y `detected_at` dentro de apertura/deadline,
  con ocultación obligatoria tras freeze. La política no usa `now()` ni el
  estado actual de la semana; admins pueden gestionar todo.
- `weekly_results`: usuarios autenticados pueden leer; solo admins pueden
  insertar, actualizar o borrar.
- `season_memberships`: usuarios autenticados pueden leer memberships; cada
  usuario puede unirse con su propio `player_id` a temporadas `active`; admins
  pueden gestionar todas las memberships.
- `week_benchmarks`: usuarios autenticados pueden leer benchmarks activos;
  admins pueden gestionar todos.
- `chat_messages`, solo si existe en el entorno: usuarios autenticados activos
  pueden leer mensajes no borrados e insertar mensajes propios; admins pueden
  gestionar todos. El borrado propio se deja como decisión futura.
- `league_chat_messages`: usuarios autenticados pueden leer mensajes; pueden
  insertar mensajes `user` solo como ellos mismos; pueden editar solo su último
  mensaje propio durante 15 minutos; no pueden insertar mensajes `system`;
  admins pueden gestionar todo.
- `home_polls`: usuarios autenticados solo pueden leer el cuestionario si está
  habilitado, abierto y con pregunta; admins pueden gestionar todo.
- `home_poll_options`: usuarios autenticados solo pueden leer opciones de un
  cuestionario habilitado, abierto y con pregunta; admins pueden gestionar todo.
- `home_poll_votes`: usuarios autenticados solo pueden leer su propio voto y
  votar o cambiar su voto en un cuestionario habilitado y abierto; admins pueden
  gestionar todo.
- `play_time_events`: sólo admins pueden leer el ledger; la escritura directa
  está revocada y el ingest autenticado usa la RPC.
- `player_game_play_time` y `player_play_time_totals`: lectura para propietario,
  admin o miembros autenticados cuando `play_time_public = true`.

Nota: si la home pública debe leer datos directamente desde Supabase sin sesión,
habrá que decidir más adelante si se añaden políticas `anon` de solo lectura o
si esas lecturas se resuelven desde servidor.

## Queda para más adelante

- QA destructivo exhaustivo de `PROFILE-ANONYMIZATION-1`, diferido
  deliberadamente; 0027 ya está aplicada y el código/schema están operativos.
- `PROFILE-PRESENCE-1` con heartbeat, expiración y privacidad propios.
- Panel completo de usuarios y gestión avanzada de memberships.
- Storage privado y subida de capturas/evidencias.
- Medallas, logros y bonus.
- Auditoría de cambios administrativos.
- Metadatos adicionales de capturas como `original_file_name`, si se necesitan
  para moderación u optimización.

## Tema claro/oscuro

La app soporta tema claro, tema oscuro y preferencia del sistema.
La preferencia visual se guarda inicialmente en el navegador con `localStorage`.
No se añaden campos a Supabase para esto en el esquema inicial. El selector vive
en `/profile`.

## Optimizacion de capturas

Antes de subir capturas a Supabase Storage, el cliente debera comprimirlas:

- Redimensionar imagenes grandes en el navegador.
- Convertir preferentemente a WebP si esta disponible.
- Usar JPEG o PNG como fallback.
- Mantener legibles puntuación y siglas.
- Evitar archivos innecesariamente grandes.
- Recomendar un maximo inicial de 1 MB o 2 MB por captura.

La compresion real no se implementa todavia.

El esquema ya reserva `screenshot_mime_type` y `screenshot_size_bytes` para
guardar el tipo y tamano del archivo resultante.

## Instalación en un entorno nuevo

Aplicar todas las migraciones ausentes de `supabase/migrations/` en orden
numérico, no sólo `0001_initial_schema.sql`, y verificar después tablas,
constraints, RLS, Realtime y Storage. `0023` debe preceder a `0024`, `0024` a
`0025`, `0025` a `0026`, `0026` a `0027` y `0027` a `0028`.

En el entorno remoto actual `0023_profile_bio_max_length.sql` y
`0024_media_uploads.sql` ya están aplicadas. También está confirmado que
`0026_submission_detected_at_window.sql` existe y ya fue aplicada remotamente:
no debe modificarse, renombrarse, duplicarse ni reaplicarse.
`0027_profile_anonymization.sql` también está aplicada remotamente;
`0028_player_presence.sql` está en el repositorio pero no debe asumirse aplicada
en remoto hasta completar el paso explícito de despliegue.

Para verificar una instalación antes de aplicarla, ejecutar el preflight SELECT-only de
`supabase/preflight/0027_profile_anonymization.sql`. La propia migración aborta
si faltan tablas o columnas de Playtime introducidas por `0025`, el índice de
`0026` u otras dependencias locales. No crear otras migraciones posteriores a
`0027` salvo que aparezca un nuevo conflicto real. El procedimiento completo está en el
[checklist de despliegue](deploy-checklist.md). `0028` es la única migración
posterior prevista por esta tarea y no reescribe 0027.

`retired_profile_usernames` conserva únicamente SHA-256 de
`lower(trim(username))` y no concede lectura a usuarios normales. Esto evita
guardar o reexponer plaintext y permite bloquear la reutilización, pero no hace
secreto por arte de magia un username de baja entropía frente a un operador con
acceso total a la base de datos.

El primer perfil admin se crea manualmente o se actualiza con privilegios de
servidor; un usuario normal nunca puede asignarse `is_admin = true`.

## Presence efímera

`0028_player_presence.sql` añade `profiles.presence_public boolean not null`
con el default histórico `false`, sin backfill desde Playtime, y crea
`player_presence_sessions`. `0029_profile_privacy_defaults.sql` cambia el
default a `true` solo para perfiles nuevos y conserva todos los valores
existentes. Su clave es `(player_id, source, client_id)`; las
fuentes son `web|launcher`, las actividades `connected|playing` y el contexto
opcional de juego se limita a `game_id`, `week_id` y
`practice|competition`. `created_at` y `last_seen_at` usan reloj de servidor.

La tabla tiene RLS sin policies generales y permisos únicamente para
`service_role`. Los endpoints autentican al usuario canónico y llaman RPCs
service-role; el cliente nunca elige `player_id`. El agregador lee primero
`presence_public` y solo después consulta sesiones vivas con TTL de 90 s. Al
desactivar privacidad o crear un tombstone, un trigger borra las sesiones en la
misma transacción. El heartbeat elimina además filas del mismo jugador con más
de 24 horas. No existe outbox ni historial de Presence.
