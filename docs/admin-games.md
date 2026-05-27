# Administración de juegos

`/admin/games` gestiona el catálogo real de juegos arcade.

Esta sección es solo para admins y usa las políticas RLS existentes de
`public.games`. No usa `service_role`.

## Juego vs semana

Un juego es una entrada reutilizable del catálogo:

- título;
- año;
- developer;
- publisher;
- ROM;
- imagen de referencia;
- metadatos básicos.

Una semana es una competición concreta que referencia a un juego y añade:

- temporada;
- número de semana;
- fechas;
- estado;
- reglas semanales;
- resultados.

Por eso las reglas, manuales descargables, ZIPs preparados y configuraciones
MAME no viven todavía en `/admin/games`.

## Metadatos flexibles

La migración `supabase/migrations/0005_game_metadata.sql` añade campos
opcionales:

- `genre`;
- `control_type`;
- `difficulty`.

Son `text` flexibles con checks de no vacío si se informan. No se usan enums
rígidos todavía para no bloquear cambios futuros.

## Listado

`/admin/games` muestra:

- título;
- año;
- developer;
- publisher;
- `rom_name`;
- género;
- tipo de control;
- dificultad;
- si tiene `image_url`;
- enlace de edición.

Incluye buscador simple por título, ROM, developer y publisher.

## Crear juego

`/admin/games/new` permite crear:

- `title` obligatorio;
- `year` opcional;
- `developer` opcional;
- `publisher` opcional;
- `rom_name` opcional;
- `genre` opcional;
- `control_type` opcional;
- `difficulty` opcional;
- `image_url` opcional;
- `notes` opcional.

Validaciones principales:

- `title` no vacío;
- `year` entre 1970 y 2100 si existe;
- textos opcionales se guardan como `null` si están vacíos;
- `image_url` debe ser `http` o `https` si se informa.

## Editar juego

`/admin/games/[gameId]` permite editar los mismos campos.

No se permite borrar juegos en esta fase para evitar romper semanas existentes
que referencian `games.id`.

## Pendiente

- Subida real de imágenes a Storage.
- Gestión de manuales semanales.
- Gestión de ZIPs o packs MAME.
- Configuraciones MAME.
- Borrado o archivado seguro de juegos.
- Relacionar descargas y reglas avanzadas desde la gestión de semanas.
