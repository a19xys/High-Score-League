# Administración de juegos

`/admin/games` gestiona el catálogo real de juegos arcade. Esta sección es solo
para admins y usa las políticas RLS existentes de `public.games`; no usa
`service_role`.

## Juego vs semana

Un juego es una entrada reutilizable del catálogo:

- título;
- año;
- desarrolladores;
- editores;
- perspectiva, tema y género;
- header externo del juego;
- logo externo del juego;
- colores manuales de acento del logo;
- instrucciones base;
- enlace externo al manual;
- enlace externo opcional de descarga del juego.

Una semana es una competición concreta que referencia a un juego y añade
temporada, número de semana, fechas, reglas específicas si hacen falta,
submissions y resultados.

## Assets y acentos

La migración `supabase/migrations/0016_game_week_assets.sql` añade
`header_image_url` y `logo_image_url`. La migración
`supabase/migrations/0017_game_accent_colors.sql` añade:

- `accent_color_primary text`;
- `accent_color_secondary text`.

Los colores son opcionales. Si se informan, deben tener formato `#RRGGBB`.
Se eligen manualmente en el admin para evitar extracción automática de colores
desde imágenes remotas. La tarjeta visual de semana usa estos acentos para su
borde y glow; si faltan, conserva el fallback circuit/cian.

`image_url` y `rom_name` se conservan en base de datos como campos legacy o
internos. No se muestran en el formulario normal de crear/editar juego y no se
deben borrar desde esta UI.

La migración `supabase/migrations/0018_game_download_url.sql` añade
`download_url` como enlace externo opcional. Es independiente de `manual_url`:
el manual documenta cómo jugar y `download_url` apunta al ZIP, carpeta,
descarga o recurso que el jugador necesita para jugar. No hay subida ni proxy
de archivos desde la web.

## Metadatos múltiples

La migración `supabase/migrations/0011_game_metadata_arrays.sql` añade:

- `developers text[] not null default '{}'`;
- `publishers text[] not null default '{}'`;
- `perspectives text[] not null default '{}'`;
- `themes text[] not null default '{}'`;
- `genres text[] not null default '{}'`.

La migración hace backfill desde columnas legacy si tenían valor. Las columnas
legacy se conservan por compatibilidad, pero la UI y el runtime usan las
columnas nuevas como fuente normal.

`control_type` y `difficulty` dejan de usarse en la UI y en el payload admin.

## Crear y editar juego

`/admin/games/new` y `/admin/games/[gameId]` permiten gestionar:

- título obligatorio;
- año opcional desde desplegable entre 1971 y el año actual;
- desarrolladores múltiples;
- editores múltiples;
- géneros múltiples;
- temas múltiples;
- perspectivas múltiples;
- header del juego opcional;
- logo del juego opcional;
- color principal del logo opcional;
- color secundario del logo opcional;
- instrucciones opcionales;
- URL del manual opcional;
- URL de descarga del juego opcional;
- notas opcionales.

Validaciones principales:

- título no vacío;
- año entre 1971 y el año actual si existe;
- arrays sin vacíos ni duplicados;
- taxonomía solo con valores permitidos;
- `header_image_url`, `logo_image_url`, `manual_url` y `download_url` deben ser
  `http` o `https` si se informan;
- `accent_color_primary` y `accent_color_secondary` deben ser `#RRGGBB` si se
  informan.

Al editar un juego existente, los campos legacy que ya existan se preservan
porque el formulario mantiene sus valores internamente aunque no los muestre.
En juegos nuevos se guardan vacíos/null.

## Listado

`/admin/games` muestra título, año, desarrolladores, editores, género combinado
y enlace de edición. Incluye buscador general y filtros avanzados por año,
género, desarrollador y editor.

En móvil se priorizan título y acción de edición.

## Borrado seguro

`DELETE /api/admin/games/[gameId]` permite borrar un juego solo si no aparece en
ninguna semana.

Las semanas futuras o todavía no anunciadas pueden quedar con
`weeks.game_id = null`; la UI pública las muestra como `Por anunciar` y el panel
admin como `Sin juego asignado`.

## Pendiente

- Subida real de imágenes a Storage.
- Subida real de manuales a Storage.
- Gestión de ZIPs o packs MAME.
- Configuraciones MAME.
- Borrado de assets asociados cuando exista Storage.
- Editor rico o Markdown avanzado.
