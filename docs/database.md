# High Score League database model

Este documento describe el esquema inicial de Supabase para el MVP. La app
todavia no esta conectada a Supabase; el SQL vive en
`supabase/migrations/0001_initial_schema.sql` para revision y aplicacion manual.

## Tablas principales

### profiles

Representa a los jugadores. Cada fila esta asociada a `auth.users(id)` y guarda
datos publicos de liga: nombre visible, siglas e indicador `is_admin`.

La bandera `is_admin` se usa para politicas RLS de gestion. El primer admin debe
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

La restriccion `unique(season_id, week_number)` evita dos semanas con el mismo
numero dentro de una misma temporada.

### submissions

Representa cada puntuacion subida por un jugador. Guarda la semana, jugador,
puntuacion, ruta de captura en Storage, metadatos basicos de la captura,
comentario opcional y flags de control:

- `is_hidden`: permite ocultar puntuaciones hasta publicar resultados.
- `is_valid`: permite invalidar una puntuacion desde administracion.
- `screenshot_mime_type`: tipo MIME informado para la captura optimizada.
- `screenshot_size_bytes`: tamano final de la captura en bytes, si se conoce.

La mejor puntuacion semanal de cada jugador se podra calcular desde esta tabla,
pero el resultado final publicado queda separado en `weekly_results`.

### weekly_results

Representa resultados finales publicados por semana. Guarda una fila estable por
jugador y semana con `final_score`, `rank`, `league_points` y flags para primer
o segundo puesto.

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
3. Los jugadores autenticados insertan filas en `submissions` con su puntuacion,
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
10. La clasificacion general de temporada se lee agregando `weekly_results`.

## Uso en el MVP

Para el MVP inicial se necesitan:

- `profiles` para jugadores y admins.
- `seasons`, `games`, `weeks` para calendario competitivo.
- `submissions` para el historial de subidas.
- `weekly_results` para resultados publicados y clasificacion estable.

## RLS inicial

Todas las tablas principales tienen Row Level Security activado.

- `profiles`: usuarios autenticados pueden leer perfiles; cada usuario puede
  insertar o actualizar su propio perfil sin poder activar `is_admin`; admins
  pueden gestionar perfiles.
- `seasons`, `games`, `weeks`: usuarios autenticados pueden leer; solo admins
  pueden insertar, actualizar o borrar.
- `submissions`: usuarios autenticados pueden leer submissions visibles y
  validas; cada jugador puede leer sus propias submissions aunque esten ocultas;
  cada jugador puede insertar submissions propias solo si la semana esta
  `active` o `frozen`; en `frozen`, la fila debe entrar como oculta; admins
  pueden gestionar todo.
- `weekly_results`: usuarios autenticados pueden leer; solo admins pueden
  insertar, actualizar o borrar.

Nota: si la home publica debe leer datos directamente desde Supabase sin sesion,
habra que decidir mas adelante si se anaden politicas `anon` de solo lectura o
si esas lecturas se resuelven desde servidor.

## Queda para mas adelante

- Trigger de creacion automatica de `profiles` al registrarse un usuario.
- Consultas reales desde Next.js.
- Subida real a Supabase Storage.
- Publicacion automatizada de resultados.
- Vistas SQL para leaderboard semanal y clasificacion de temporada.
- Auditoria de cambios administrativos.
- Metadatos adicionales de capturas como `original_file_name`, si se necesitan
  para moderacion u optimizacion.

## Tema claro/oscuro

La app debera soportar tema claro, tema oscuro y preferencia del sistema en una
fase posterior. La preferencia visual se guardara inicialmente en el navegador,
por ejemplo con `localStorage` o una solucion equivalente. No se anaden campos a
Supabase para esto en el esquema inicial.

## Optimizacion de capturas

Antes de subir capturas a Supabase Storage, el cliente debera comprimirlas:

- Redimensionar imagenes grandes en el navegador.
- Convertir preferentemente a WebP si esta disponible.
- Usar JPEG o PNG como fallback.
- Mantener legibles puntuacion y siglas.
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
