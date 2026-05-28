# Administración de temporadas

`/admin/seasons` gestiona temporadas reales desde la web.

Esta sección es solo para admins. Usa la sesión Supabase normal y RLS; no usa
`service_role`.

## Temporada, semana y juego

Una temporada agrupa semanas y miembros. Define:

- nombre;
- slug público;
- versión opcional;
- estado;
- fechas de inicio y fin.

Una semana pertenece a una temporada y define el juego activo, fechas
competitivas, reglas y resultados semanales.

Un juego pertenece al catálogo y puede reutilizarse en distintas semanas.

## Estados

Estados permitidos:

- `draft`: no debe aparecer públicamente.
- `active`: permite que usuarios se unan.
- `completed`: temporada cerrada; no permite nuevas uniones.

## Listado

`/admin/seasons` muestra:

- nombre;
- slug;
- estado;
- versión;
- fechas;
- número de semanas;
- número de miembros;
- enlace de edición.

Incluye buscador simple por `name` y `slug`.

## Crear temporada

`/admin/seasons/new` permite crear:

- `name` obligatorio;
- `slug` obligatorio;
- `version` opcional;
- `status` obligatorio;
- `starts_at` opcional;
- `ends_at` opcional.

Crear una temporada no crea semanas automáticamente.

## Editar temporada

`/admin/seasons/[seasonId]` permite editar los mismos campos.

También muestra de forma informativa:

- miembros unidos;
- semanas asociadas;
- enlace a la página pública `/seasons/[slug]`;
- enlaces a gestión admin de cada semana.

No se implementa gestión avanzada de miembros en esta fase.

## Validaciones

- `name` no puede estar vacío.
- `slug` usa minúsculas, números y guiones.
- `version` es opcional, pero si se informa no puede estar vacía.
- `status` debe ser `draft`, `active` o `completed`.
- `starts_at` y `ends_at`, si existen, deben ser ISO con zona horaria explícita.
- Si ambas fechas existen, `starts_at <= ends_at`.
- No se permite más de una temporada con `status = active`.
- Si dos temporadas tienen `starts_at` y `ends_at`, sus rangos no pueden
  solaparse.

Ejemplos de fechas válidas:

```text
2026-05-18T00:00:00+02:00
2026-07-12T23:59:00+02:00
```

## Sin borrado

No se permite borrar temporadas en esta fase para evitar romper semanas,
`weekly_results`, standings y membresías.

## Pendiente

- Creación avanzada de semanas.
- Gestión avanzada de miembros.
- Borrado o archivado seguro de temporadas.
- Medallas.
- Panel completo de usuarios.
