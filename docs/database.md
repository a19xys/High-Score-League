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

### games

Catalogo de juegos arcade. No depende de una temporada concreta, de forma que un
juego pueda reutilizarse en futuras temporadas.

### weeks

Representa una semana competitiva dentro de una temporada. Relaciona
`season_id` con `game_id`, define `week_number`, fechas de apertura/cierre y
estado `draft`, `active`, `frozen`, `closed` o `published`.

La restricción `unique(season_id, week_number)` evita dos semanas con el mismo
número dentro de una misma temporada.

### submissions

Representa cada puntuación subida por un jugador. Guarda la semana, jugador,
puntuación, ruta de captura en Storage, metadatos básicos de la captura,
comentario opcional y flags de control:

- `is_hidden`: permite ocultar puntuaciones hasta publicar resultados.
- `is_valid`: permite invalidar una puntuación desde administración.
- `screenshot_mime_type`: tipo MIME informado para la captura optimizada.
- `screenshot_size_bytes`: tamaño final de la captura en bytes, si se conoce.

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

## Flujo semanal de datos

1. Un admin crea una temporada, juegos y semanas.
2. Una semana pasa a `active`.
3. Los jugadores autenticados insertan filas en `submissions` con su puntuación,
   ruta de captura y metadatos de archivo.
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

Nota: si la home pública debe leer datos directamente desde Supabase sin sesión,
habrá que decidir más adelante si se añaden políticas `anon` de solo lectura o
si esas lecturas se resuelven desde servidor.

## Queda para mas adelante

- Trigger de creacion automatica de `profiles` al registrarse un usuario.
- Consultas reales desde Next.js.
- Subida real a Supabase Storage.
- Publicacion automatizada de resultados.
- Vistas SQL para leaderboard semanal y clasificación de temporada, incluyendo
  movimiento de posición respecto a la semana anterior.
- Auditoría de cambios administrativos.
- Metadatos adicionales de capturas como `original_file_name`, si se necesitan
  para moderacion u optimizacion.

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
