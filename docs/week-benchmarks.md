# Week benchmarks

Los benchmarks de semana son referencias visuales dentro del leaderboard. No
son submissions reales: no tienen jugador, perfil ni puntos; tampoco generan
`weekly_results`, afectan a `M` o aparecen en el historial de envíos.

## Datos y compatibilidad

`0004_week_benchmarks.sql` crea `public.week_benchmarks`. La migración
`0030_week_benchmark_images.sql` añade la columna nullable
`image_storage_path`, limitada por constraint a:

```text
benchmarks/icons/<UUID>.webp
```

La URL pública se deriva del bucket `hsl-public-media`; no se guardan URLs
externas ni identificadores de semana, benchmark o label en el nombre del
objeto. Si el path es `null`, la UI muestra el fallback neutral `REF`.

`icon_key`, incorporado históricamente por `0019`, permanece en la base de
datos durante la ventana de compatibilidad con despliegues web anteriores. Es
legacy/deprecated: la web actual no lo selecciona, edita ni renderiza, y ya no
usa los tres speedometers preestablecidos. Una migración futura podrá retirarlo
cuando no quede una versión desplegada que lo consuma.

Campos activos principales:

- `week_id`;
- `label`;
- `score`;
- `description`;
- `image_storage_path`;
- `sort_order`;
- `is_active`.

## Administración y lifecycle

Crear y editar comparten el mismo formulario: imagen en su propia fila,
nombre/puntuación, descripción y acciones. `MediaUpload` procesa JPEG, PNG o
WebP a un WebP máximo de 256 × 256, conserva el canal alfa y sube un UUID nuevo.

El ciclo es `upload → persistencia API → cleanup` mediante `executeMediaSave`:

- si POST/PATCH falla, se elimina el objeto recién subido;
- un reemplazo retira la imagen anterior solo después del PATCH correcto;
- Quitar persiste `null` antes de limpiar el objeto anterior;
- DELETE lee primero `image_storage_path`, borra la fila y después intenta
  limpiar Storage; si esa limpieza falla, devuelve un warning sin restaurar la
  fila.

Las APIs solo aceptan `imageStoragePath` con el patrón administrado. Rechazan
URLs públicas y paths de otras familias. Las policies de Storage permiten
`INSERT`, `SELECT` y `DELETE` en el prefijo exacto únicamente a usuarios
autenticados para los que `public.is_admin()` sea verdadero.

## Orden visual

El leaderboard mezcla jugadores y benchmarks por puntuación descendente. Ante
la misma puntuación, el jugador aparece primero; entre benchmarks se usa
`sort_order` y después `label`. La imagen se muestra completa con
`object-contain`, sin máscara ni tinte. Un benchmark sin imagen conserva el
mismo ancho de referencia mediante `REF`.

## Despliegue

`0030_week_benchmark_images.sql` y su preflight SELECT-only están preparados en
el repositorio, pero la migración no se ha aplicado remotamente en esta tarea.
El orden obligatorio es: ejecutar el preflight, aplicar `0030`, verificar
columna/constraint/policies, desplegar la web compatible y hacer QA del
lifecycle con un benchmark desechable.
