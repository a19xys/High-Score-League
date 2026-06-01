# Administracion de semanas

El panel minimo de semanas permite crear, editar y operar semanas reales desde la
web sin usar SQL manual para el flujo semanal basico.

## Rutas

- `/admin/weeks`: listado de semanas reales.
- `/admin/weeks/new`: creación de una semana.
- `/admin/weeks/[weekId]`: cuadro de mandos operativo de una semana.
- `/admin/weeks/[weekId]/edit`: edición de metadatos de una semana.

Todas las rutas requieren sesion y `profiles.is_admin = true`. La comprobacion
se hace en servidor.

## Calendario simplificado

En UI el admin gestiona fechas simples, no timestamps completos:

- Apertura: se guarda en `public_start_at`.
- Tramo final: se guarda en `public_freeze_at` y es opcional.
- Cierre: se guarda en `final_deadline_at`.

El formulario muestra inputs `YYYY-MM-DD`. El servidor convierte internamente:

- apertura a `00:00:00` en zona `Europe/Madrid`;
- tramo final a `00:00:00` en zona `Europe/Madrid`;
- cierre a `23:59:59` en zona `Europe/Madrid`.

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

`closed` revela puntuaciones y deja de aceptar submissions, pero no cuenta para
la clasificación de temporada. `published` se mantiene como estado interno útil
para resultados oficiales. El endpoint `/api/cron/process-schedule` sincroniza
estos estados por fechas, pero no genera resultados al cierre.

## Crear semana

`/admin/weeks/new` permite definir:

- temporada (`season_id`);
- juego (`game_id`);
- apertura;
- tramo final mediante selector;
- cierre;
- instrucciones específicas opcionales.

Tambien puede abrirse con una temporada precargada:

```text
/admin/weeks/new?seasonId=SEASON_ID
```

Si no llega `seasonId`, el formulario selecciona la temporada activa si existe.
El selector incluye siempre la opción `Selecciona una`. El juego no se autoselecciona:
el selector empieza en `Elige uno`.

El `week_number` no se pide al admin al crear. El servidor lo calcula segun la
posicion cronologica de la semana dentro de su temporada. Si una semana nueva o
editada queda entre semanas existentes, se renumeran las semanas de esa
temporada para mantener numeros consecutivos sin huecos ni duplicados.

Crear una semana no crea submissions, resultados oficiales ni benchmarks
automáticamente.

No se pueden crear semanas dentro de una temporada `completed`.

## Instrucciones

`weeks.rules_summary` se mantiene en base de datos, pero en la UI se interpreta
como override opcional de instrucciones de semana.

Prioridad de visualización:

1. si `weeks.rules_summary` tiene texto, se muestran esas instrucciones
   específicas;
2. si está vacío y `games.instructions` tiene texto, se muestran las
   instrucciones base del juego;
3. si ambos faltan, se muestra un estado vacío.

El formulario lo muestra como `Instrucciones específicas de esta semana` con la
ayuda `Déjalo vacío para usar las instrucciones del juego asociado`.

## Validaciones

Las fechas deben usar ISO con zona horaria explicita:

```text
2026-05-18
```

El tramo final se elige con modos:

- todo el plazo;
- ultimos 3 dias;
- sin tramo final;
- personalizado al editar si las fechas existentes no coinciden con un modo.

El orden valido resultante es:

```text
apertura <= tramo final <= cierre
```

El tramo final puede quedar vacio. Apertura y cierre son obligatorios en los
formularios admin actuales.

Validaciones server-side:

- `week_number` no debe duplicarse dentro de una temporada.
- Si una semana tiene apertura y cierre, no puede solaparse con otra semana de
  la misma temporada que tambien tenga apertura y cierre.
- Si la temporada tiene `starts_at` y `ends_at`, la semana debe quedar dentro de
  esas fechas.
- Si hay solape con semanas posteriores, el admin puede marcar `Retrasar
  semanas posteriores si hay solape`. Sin esa confirmacion explicita, el
  servidor devuelve error.
- El desplazamiento solo afecta semanas posteriores de la misma temporada,
  mantiene duración y tramo final relativo, y después renumera por orden
  cronológico.
- No se desplazan semanas con `weekly_results`.
- Si el desplazamiento haria que una semana saliera de `ends_at` de la
  temporada, se rechaza. La temporada no se extiende automáticamente.

## Editar semana

`/admin/weeks/[weekId]/edit` edita los mismos datos principales.

El numero de semana no es editable. Al guardar, se vuelve a calcular por
posicion cronologica.

Tras guardar, el servidor ejecuta una reconciliacion de semana:

- sincroniza el `status` interno con las nuevas fechas;
- recalcula `is_hidden` de submissions validas usando `detected_at` y, si falta,
  `submitted_at`;
- si la semana tenia `weekly_results` y las nuevas fechas la reabren, elimina
  esos resultados oficiales.

Esto es intencional: una semana reabierta vuelve a comportarse como una semana
sin resultados oficiales para que la clasificacion de temporada deje de contarla
hasta que el admin vuelva a publicarla.

La pantalla incluye una gestion basica de benchmarks visuales:

- listar benchmarks existentes;
- crear benchmark con etiqueta, puntuación y descripción opcional;
- ver benchmarks existentes en modo lectura por defecto;
- editar un único benchmark cada vez;
- eliminar benchmarks reales con confirmación.

Los benchmarks son referencias visuales del leaderboard. No son submissions, no
generan puntos y no afectan a `weekly_results`.

No se pueden editar semanas ni benchmarks de semanas pertenecientes a una
temporada `completed`.

## Borrado seguro de semanas

`/admin/weeks/[weekId]/edit` incluye una zona peligrosa para borrar semanas
solo cuando el borrado es seguro.

Una semana es borrable si:

- su temporada no está `completed`;
- no tiene submissions;
- no tiene `weekly_results`;
- no está abierta por fechas;
- no está en tramo final;
- no está cerrada ni publicada;
- sigue siendo una semana futura o interna de configuración.

El endpoint `DELETE /api/admin/weeks/[weekId]` exige admin en servidor. Si la
semana no es borrable devuelve:

```json
{
  "ok": false,
  "code": "WEEK_NOT_DELETABLE",
  "error": "Solo se pueden borrar semanas inactivas sin submissions ni resultados."
}
```

Al borrar una semana se elimina la fila de `weeks`; los benchmarks asociados se
eliminan por cascada y después se renumeran las semanas restantes de la
temporada. No se borran juegos, temporadas ni usuarios.

## Cuadro de mandos

`/admin/weeks/[weekId]` se mantiene como la pagina operativa:

- revisar submissions;
- marcar submissions validas o invalidas;
- hacer dry run de resultados;
- regenerar `weekly_results` si hace falta.

Los metadatos de la semana se editan desde `/admin/weeks/[weekId]/edit` para
mantener separadas las operaciones semanales de la edición de datos.

## Pendiente

No se implementa todavia:

- configuracion de Vercel Cron en el repositorio;
- subida de manuales;
- ZIPs o descargas configuradas;
- configuraciones MAME;
- Storage;
- capturas reales;
- medallas;
- plugin MAME;
- app local.
