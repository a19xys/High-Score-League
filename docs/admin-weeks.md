# Administracion de semanas

El panel minimo de semanas permite crear, editar y operar semanas reales desde la
web sin usar SQL manual para el flujo semanal basico.

## Rutas

- `/admin/weeks`: listado de semanas reales.
- `/admin/weeks/new`: creacion de una semana.
- `/admin/weeks/[weekId]`: cuadro de mandos operativo de una semana.
- `/admin/weeks/[weekId]/edit`: edicion de metadatos de una semana.

Todas las rutas requieren sesion y `profiles.is_admin = true`. La comprobacion
se hace en servidor.

## Calendario simplificado

En UI el admin gestiona tres fechas principales:

- Apertura: se guarda en `public_start_at`.
- Tramo final: se guarda en `public_freeze_at` y es opcional.
- Cierre: se guarda en `final_deadline_at`.

`reveal_at` queda como campo legacy y no se muestra en el formulario principal.
No se borra de base de datos para mantener compatibilidad con datos existentes.

## Estado derivado

La app usa un helper centralizado para derivar el estado visible desde fechas y
estado base:

- `draft`: configuracion no publica.
- `scheduled`: aun no llego la apertura.
- `active`: entre apertura y cierre.
- `final_stretch`: entre tramo final y cierre.
- `closed`: cierre alcanzado sin resultados oficiales.
- `published`: semana publicada o con resultados oficiales.

En la UI publica, `active` y `final_stretch` se muestran como competicion activa.
Durante el tramo final, el ingest acepta submissions pero guarda las nuevas
puntuaciones ocultas hasta el cierre.

`published` se mantiene por ahora como estado interno util para resultados
oficiales. No hay cron automatico todavia: el estado se deriva en lectura y las
operaciones admin siguen siendo manuales.

## Crear semana

`/admin/weeks/new` permite definir:

- temporada (`season_id`);
- juego (`game_id`);
- numero de semana;
- estado base (`draft`, `active`, `frozen`, `closed`, `published`);
- apertura;
- tramo final opcional;
- cierre;
- reglas resumidas.

Tambien puede abrirse con una temporada precargada:

```text
/admin/weeks/new?seasonId=SEASON_ID
```

Crear una semana no crea submissions, resultados oficiales ni benchmarks
automaticamente.

## Validaciones

Las fechas deben usar ISO con zona horaria explicita:

```text
2026-05-18T00:00:00+02:00
```

El orden valido es:

```text
apertura <= tramo final <= cierre
```

El tramo final puede quedar vacio. Si apertura o cierre faltan, la app conserva
compatibilidad con datos legacy y no aplica validacion estricta de solape.

Validaciones server-side:

- `week_number` no debe duplicarse dentro de una temporada.
- No se permiten dos semanas con `status = active` al mismo tiempo.
- Si una semana tiene apertura y cierre, no puede solaparse con otra semana de
  la misma temporada que tambien tenga apertura y cierre.

## Editar semana

`/admin/weeks/[weekId]/edit` edita los mismos datos principales. No borra
semanas y no modifica submissions ni `weekly_results`.

La pantalla incluye una gestion basica de benchmarks visuales:

- listar benchmarks existentes;
- crear benchmark;
- editar label, score, descripcion, orden e indicador activo;
- activar o desactivar benchmark.

Los benchmarks son referencias visuales del leaderboard. No son submissions, no
generan puntos y no afectan a `weekly_results`.

## Cuadro de mandos

`/admin/weeks/[weekId]` se mantiene como la pagina operativa:

- cambiar estado base;
- revisar submissions;
- marcar submissions validas o invalidas;
- hacer dry run de resultados;
- generar `weekly_results`;
- marcar una semana como publicada.

Los metadatos de la semana se editan desde `/admin/weeks/[weekId]/edit` para
mantener separadas las operaciones semanales de la edicion de datos.

## Pendiente

No se implementa todavia:

- cron automatico de estados;
- borrado de semanas;
- subida de manuales;
- ZIPs o descargas configuradas;
- configuraciones MAME;
- Storage;
- capturas reales;
- medallas;
- plugin MAME;
- app local.
