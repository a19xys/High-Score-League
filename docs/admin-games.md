# Administración de juegos

`/admin/games` gestiona el catálogo real de juegos arcade. Esta sección es
solo para admins y usa las políticas RLS existentes de `public.games`; no usa
`service_role`.

## Juego vs semana

Un juego es una entrada reutilizable del catálogo:

- título;
- año;
- desarrolladores;
- editores;
- ROM;
- perspectiva, tema y género;
- imagen de referencia;
- instrucciones base;
- enlace externo al manual.

Una semana es una competición concreta que referencia a un juego y añade
temporada, número de semana, fechas, estado, instrucciones específicas si hacen
falta y resultados.

## Metadatos múltiples

La migración `supabase/migrations/0011_game_metadata_arrays.sql` añade:

- `developers text[] not null default '{}'`;
- `publishers text[] not null default '{}'`;
- `perspectives text[] not null default '{}'`;
- `themes text[] not null default '{}'`;
- `genres text[] not null default '{}'`.

La migración hace backfill desde `developer`, `publisher` y `genre` si tenían
valor. Las columnas legacy se conservan en base de datos por compatibilidad,
pero la UI y el runtime usan las columnas nuevas como fuente de verdad.

`control_type` y `difficulty` dejan de usarse en la UI y en el payload admin.

## Taxonomía

Perspectiva, tema y género se validan contra listas cerradas en
`lib/admin/game-taxonomy.ts`. Desarrolladores y editores siguen siendo texto
libre, pero admiten múltiples entradas sin vacíos ni duplicados.

En listados, la columna `Género` muestra una combinación compacta de:

- perspectivas;
- temas;
- géneros.

Ejemplo: `Lateral · Acción · Plataformas`.

## Listado

`/admin/games` muestra:

- título;
- año;
- desarrolladores;
- editores;
- género combinado;
- ROM;
- enlace de edición.

Incluye buscador general y filtros avanzados por año, desarrollador, editor y
género combinado. En móvil se priorizan solo título y acción de edición; el
título ya no es enlace para evitar una tabla demasiado cargada en pantallas
pequeñas.

## Crear y editar juego

`/admin/games/new` y `/admin/games/[gameId]` permiten gestionar:

- título obligatorio;
- año opcional desde desplegable entre 1971 y el año actual;
- desarrolladores múltiples;
- editores múltiples;
- ROM opcional;
- perspectivas múltiples;
- temas múltiples;
- géneros múltiples;
- URL de imagen opcional;
- instrucciones opcionales;
- URL del manual opcional;
- notas opcionales.

Validaciones principales:

- título no vacío;
- año entre 1971 y el año actual si existe;
- arrays sin vacíos ni duplicados;
- taxonomía solo con valores permitidos;
- `image_url` y `manual_url` deben ser `http` o `https` si se informan.

## Borrado seguro

`DELETE /api/admin/games/[gameId]` permite borrar un juego solo si no aparece en
ninguna semana.

Las semanas futuras o todavía no anunciadas no usan un juego real placeholder.
En base de datos pueden quedar con `weeks.game_id = null`; la UI pública las
muestra como `Por anunciar` y el panel admin como `Sin juego asignado`.

Si existe alguna fila en `weeks` con ese `game_id`, el endpoint devuelve:

```json
{
  "ok": false,
  "code": "GAME_IN_USE",
  "error": "No se puede borrar un juego usado por una semana."
}
```

La pantalla de edición muestra una zona peligrosa. Si el juego está usado, el
borrado queda desactivado. Si no está usado, exige escribir `BORRAR` y luego
redirige a `/admin/games`.

## Pendiente

- Subida real de imágenes a Storage.
- Subida real de manuales a Storage.
- Gestión de ZIPs o packs MAME.
- Configuraciones MAME.
- Borrado de assets asociados cuando exista Storage.
- Editor rico o Markdown avanzado.
