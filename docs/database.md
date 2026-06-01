# High Score League database model

Este documento describe el esquema inicial de Supabase para el MVP. La app
todavia no esta conectada a Supabase; el SQL vive en
`supabase/migrations/0001_initial_schema.sql` para revision y aplicacion manual.

## Tablas principales

### profiles

Representa a los jugadores. Cada fila está asociada a `auth.users(id)` y guarda
datos públicos de liga: `username`, siglas, `avatar_url` opcional e indicador
`is_admin`.

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

### seasons

Representa una temporada completa, por ejemplo `Temporada I`. Tiene `slug`,
`version`, fechas opcionales y estado `draft`, `active` o `completed`.

El panel admin mínimo permite crear y editar temporadas, pero no las borra ni
crea semanas automáticamente.

### games

Catalogo de juegos arcade. No depende de una temporada concreta, de forma que un
juego pueda reutilizarse en futuras temporadas.

Desde `0005_game_metadata.sql` incluye metadatos opcionales de UI:

- `genre`;
- `control_type`;
- `difficulty`.

Son campos `text` flexibles. Pueden ser `null`, pero si existen no pueden ser
texto vacío. No se usan enums todavía.

Desde `0009_game_instructions.sql` incluye instrucciones base y manual externo:

- `instructions`: instrucciones base del juego;
- `manual_url`: enlace externo opcional al manual.

`manual_url` puede ser `null`, pero si existe debe empezar por `http://` o
`https://`. No hay Storage ni subida de manuales todavía.

### weeks

Representa una semana competitiva dentro de una temporada. Relaciona
`season_id` con `game_id`, define `week_number`, fechas de apertura/cierre y
estado `draft`, `active`, `frozen`, `closed` o `published`.

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
- `detected_at`: momento detectado por MAME o la app local.
- `submitted_at`: momento recibido por la web; lo fuerza el servidor.
- `rom_name`, `mame_version`, `client_version`: contexto técnico del evento.
- `raw_event`: payload original para depuración y auditoría.
- `duplicate_key`: clave de idempotencia para reintentos.
- `screenshot_path`: ruta opcional de captura en Storage.
- `screenshot_mime_type`: tipo MIME informado para la captura optimizada.
- `screenshot_size_bytes`: tamaño final de la captura en bytes, si se conoce.

Las capturas son opcionales desde `0002_submission_events.sql`, porque el flujo
futuro principal será automático: plugin MAME, evento JSON local, app local y API
web. La subida manual desde la web queda como fallback o herramienta
provisional.

La app permite subir puntuaciones aunque no superen el récord personal. La mejor
puntuación semanal de cada jugador se podrá calcular desde esta tabla, mientras
el número de subidas cuenta todas las submissions válidas de la semana. El
resultado final publicado queda separado en `weekly_results`.

### weekly_results

Representa resultados finales publicados por semana. Guarda una fila estable por
jugador y semana con `final_score`, `rank`, `league_points` y flags para primer,
segundo o tercer puesto.

La clasificación de temporada podrá agregarse desde esta tabla sumando puntos y
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
- `sort_order`
- `is_active`

### league_chat_messages

Representa el chat global real de la liga en la portada. Se crea en
`0006_league_chat.sql`.

Campos principales:

- `message_type`: `user` o `system`.
- `author_id`: perfil autor para mensajes `user`; `null` para mensajes
  `system`.
- `content`: texto del mensaje, máximo 500 caracteres.
- `created_at`.

El chat conserva solo los 50 mensajes más nuevos mediante trigger. Al crear un
perfil nuevo, otro trigger inserta un mensaje `system` con el username.

La tabla inicial `chat_messages` queda como preparación histórica anterior; el
chat conectado de la home usa `league_chat_messages`.

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

No se calcula automaticamente en esta fase. Mas adelante el panel admin podra
generar o revisar estas filas antes de publicar una semana.

## Relaciones

- `profiles.id` referencia `auth.users.id`.
- `weeks.season_id` referencia `seasons.id`.
- `weeks.game_id` referencia `games.id`.
- `submissions.week_id` referencia `weeks.id`.
- `submissions.player_id` referencia `profiles.id`.
- `weekly_results.week_id` referencia `weeks.id`.
- `weekly_results.player_id` referencia `profiles.id`.
- `chat_messages.player_id` referencia `profiles.id`.
- `league_chat_messages.author_id` referencia `profiles.id` con
  `on delete set null`.
- `season_memberships.season_id` referencia `seasons.id`.
- `season_memberships.player_id` referencia `profiles.id`.
- `week_benchmarks.week_id` referencia `weeks.id`.

## Flujo semanal de datos

1. Un admin crea una temporada, juegos y semanas.
2. Una semana pasa a `active`.
3. Los jugadores autenticados insertan filas en `submissions` con su puntuación.
   En una fase posterior, la API de ingestión recibirá eventos automáticos desde
   la app local.
4. En estado `active`, una submission puede insertarse visible u oculta.
5. En estado `frozen`, una submission solo puede insertarse con
   `is_hidden = true`.
6. No se pueden insertar submissions en semanas `draft`, `closed` o
   `published`.
7. Mientras `is_hidden = true`, una submission solo la ve su jugador y admins.
8. Al cerrar la semana, el admin revisa submissions y puede marcar errores con
   `is_valid = false`.
9. Al publicar, el admin crea filas en `weekly_results`.
10. La clasificación general de temporada se lee agregando `weekly_results`.
11. La portada lee los últimos 50 mensajes desde `league_chat_messages`.

Las fechas de cierre y revelación existen como datos de la semana. En la UI mock
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

## Uso en el MVP

Para el MVP inicial se necesitan:

- `profiles` para jugadores y admins.
- `seasons`, `games`, `weeks` para calendario competitivo.
- `submissions` para el historial de subidas.
- `weekly_results` para resultados publicados y clasificación estable.
- `league_chat_messages` para el chat global real de la liga.

En la interfaz mock, `positionChange` simula el movimiento de cada jugador
respecto a la semana anterior. Más adelante se calculará comparando resultados
publicados en `weekly_results`.

## RLS inicial

Todas las tablas principales tienen Row Level Security activado.

- `profiles`: usuarios autenticados pueden leer perfiles; cada usuario puede
  insertar o actualizar su propio perfil sin poder activar `is_admin`; admins
  pueden gestionar perfiles. El perfil usa `username`, `initials`,
  `avatar_url` opcional e `is_admin`.
- `seasons`, `games`, `weeks`: usuarios autenticados pueden leer; solo admins
  pueden insertar, actualizar o borrar.
- `submissions`: usuarios autenticados pueden leer submissions visibles y
  válidas; cada jugador puede leer sus propias submissions aunque estén ocultas;
  cada jugador puede insertar submissions propias solo si la semana esta
  `active` o `frozen`; en `frozen`, la fila debe entrar como oculta; admins
  pueden gestionar todo.
- `weekly_results`: usuarios autenticados pueden leer; solo admins pueden
  insertar, actualizar o borrar.
- `season_memberships`: usuarios autenticados pueden leer memberships; cada
  usuario puede unirse con su propio `player_id` a temporadas `active`; admins
  pueden gestionar todas las memberships.
- `week_benchmarks`: usuarios autenticados pueden leer benchmarks activos;
  admins pueden gestionar todos.
- `chat_messages`: usuarios autenticados pueden leer mensajes no borrados e
  insertar mensajes propios; admins pueden gestionar todos. El borrado propio se
  deja como decisión futura para no abrir permisos antes de definir moderación.
- `league_chat_messages`: usuarios autenticados pueden leer mensajes; pueden
  insertar mensajes `user` solo como ellos mismos; no pueden insertar mensajes
  `system`; admins pueden gestionar todo.

Nota: si la home pública debe leer datos directamente desde Supabase sin sesión,
habrá que decidir más adelante si se añaden políticas `anon` de solo lectura o
si esas lecturas se resuelven desde servidor.

## Queda para mas adelante

- Trigger de creacion automatica de `profiles` al registrarse un usuario.
- Consultas reales desde Next.js.
- Subida real a Supabase Storage.
- Panel admin completo para revisar y publicar resultados.
- Panel admin completo de temporadas, juegos y usuarios.
- Vistas SQL para leaderboard semanal y clasificación de temporada, incluyendo
  movimiento de posición respecto a la semana anterior.
- Auditoría de cambios administrativos.
- Metadatos adicionales de capturas como `original_file_name`, si se necesitan
  para moderacion u optimizacion.
- Realtime para el chat de portada.

## Tema claro/oscuro

La app soporta en fase mock tema claro, tema oscuro y preferencia del sistema.
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

## Aplicacion manual en Supabase Dashboard

1. Abrir el proyecto en Supabase.
2. Ir a `SQL Editor`.
3. Crear una nueva query.
4. Pegar el contenido de `supabase/migrations/0001_initial_schema.sql`.
5. Ejecutar la query.
6. Revisar que las tablas existen en `Table Editor`.
7. Crear manualmente el primer perfil admin o actualizar `is_admin = true` para
   el usuario que vaya a gestionar la liga.

Si se usa Supabase CLI mas adelante, el archivo puede aplicarse como migracion
normal desde la carpeta `supabase/migrations`.
