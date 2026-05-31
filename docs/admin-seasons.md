# Administracion de temporadas

`/admin/seasons` gestiona temporadas reales desde la web.

Esta seccion es solo para admins. Usa la sesion Supabase normal y RLS; no usa
`service_role`.

## Temporada, semana y juego

Una temporada agrupa semanas y miembros. Define:

- nombre;
- slug publico;
- version opcional;
- fecha de inicio;
- fecha de fin.

Una semana pertenece a una temporada y define el juego activo, fechas
competitivas, reglas y resultados semanales.

Un juego pertenece al catalogo y puede reutilizarse en distintas semanas.

## Estados internos

El admin ya no elige estado manualmente. El sistema sincroniza:

- `draft`: antes de `starts_at`;
- `active`: entre `starts_at` y `ends_at`;
- `completed`: despues de `ends_at`.

El endpoint `/api/cron/process-schedule` actualiza estos estados en base de
datos. Las vistas tambien pueden derivar el estado para no depender de una
sincronizacion inmediata.

## Listado

`/admin/seasons` muestra:

- nombre;
- slug;
- estado sincronizado o derivado;
- version;
- fechas;
- numero de semanas;
- numero de miembros;
- enlace de edicion.

Incluye buscador simple por `name` y `slug`.

## Crear temporada

`/admin/seasons/new` permite crear:

- `name` obligatorio;
- `slug` obligatorio;
- `version` opcional;
- `starts_at` obligatorio;
- `ends_at` obligatorio.

Crear una temporada no crea semanas automaticamente.

## Editar temporada

`/admin/seasons/[seasonId]` permite editar los mismos campos.

Tambien muestra de forma informativa:

- miembros unidos;
- semanas asociadas;
- enlace a la pagina publica `/seasons/[slug]`;
- enlaces a gestion admin de cada semana.

No se implementa gestion avanzada de miembros en esta fase.

Si una temporada ya esta `completed`, no se pueden crear ni editar semanas
dentro de ella, ni editar benchmarks o regenerar resultados semanales desde el
panel admin normal. Cualquier reapertura de una temporada completada queda como
accion admin futura especifica.

## Validaciones

- `name` no puede estar vacio.
- `slug` usa minusculas, numeros y guiones.
- `version` es opcional, pero si se informa no puede estar vacia.
- `starts_at` y `ends_at` deben ser ISO con zona horaria explicita.
- `starts_at <= ends_at`.
- Si dos temporadas tienen `starts_at` y `ends_at`, sus rangos no pueden
  solaparse.

Ejemplos de fechas validas:

```text
2026-05-18T00:00:00+02:00
2026-07-12T23:59:00+02:00
```

## Borrado seguro

`/admin/seasons/[seasonId]` incluye una zona peligrosa para borrar temporadas
solo cuando el borrado es seguro.

Una temporada es borrable si:

- está inactiva o en borrador por fechas;
- no está activa;
- no está `completed`;
- ninguna de sus semanas tiene submissions;
- ninguna de sus semanas tiene `weekly_results`.

El endpoint `DELETE /api/admin/seasons/[seasonId]` exige admin en servidor. Si la
temporada no es borrable devuelve:

```json
{
  "ok": false,
  "code": "SEASON_NOT_DELETABLE",
  "error": "Solo se pueden borrar temporadas inactivas sin submissions ni resultados."
}
```

Al borrar una temporada se elimina la fila de `seasons`; sus semanas,
benchmarks y membresías asociadas se eliminan por cascada. No se borran juegos
ni usuarios.

## Pendiente

- Gestion avanzada de miembros.
- Archivado seguro de temporadas.
- Medallas.
- Panel completo de usuarios.
