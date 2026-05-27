# Administración de semanas

El panel mínimo de semanas permite crear, editar y operar semanas reales desde la
web sin usar SQL manual para el flujo semanal básico.

## Rutas

- `/admin/weeks`: listado de semanas reales.
- `/admin/weeks/new`: creación de una semana.
- `/admin/weeks/[weekId]`: cuadro de mandos operativo de una semana.
- `/admin/weeks/[weekId]/edit`: edición de metadatos de una semana.

Todas las rutas requieren sesión y `profiles.is_admin = true`. La comprobación
se hace en servidor; ocultar enlaces en la UI no es la única protección.

## Listado

`/admin/weeks` muestra temporada, número de semana, juego, estado, rango de
fechas, número de submissions, submissions inválidas, si hay resultados
oficiales y enlace para gestionar la semana.

El botón `Crear semana` abre `/admin/weeks/new`.

## Crear semana

`/admin/weeks/new` permite definir:

- temporada (`season_id`);
- juego (`game_id`);
- número de semana;
- estado (`draft`, `active`, `frozen`, `closed`, `published`);
- `public_start_at`;
- `public_freeze_at`;
- `final_deadline_at`;
- `reveal_at`;
- reglas resumidas.

También puede abrirse con una temporada precargada:

```text
/admin/weeks/new?seasonId=SEASON_ID
```

Crear una semana no crea submissions, resultados oficiales ni benchmarks
automáticamente.

## Editar semana

`/admin/weeks/[weekId]/edit` edita los mismos datos principales. No borra
semanas y no modifica submissions ni `weekly_results`.

La pantalla incluye una gestión básica de benchmarks visuales:

- listar benchmarks existentes;
- crear benchmark;
- editar label, score, descripción, orden e indicador activo;
- activar o desactivar benchmark.

Los benchmarks son referencias visuales del leaderboard. No son submissions, no
generan puntos y no afectan a `weekly_results`.

## Cuadro de mandos

`/admin/weeks/[weekId]` se mantiene como la página operativa:

- cambiar estado;
- revisar submissions;
- marcar submissions válidas o inválidas;
- hacer dry run de resultados;
- generar `weekly_results`;
- marcar una semana como publicada.

Los metadatos de la semana se editan desde `/admin/weeks/[weekId]/edit` para
mantener separadas las operaciones semanales de la edición de datos.

## Fechas

Las fechas son opcionales, pero si se informan deben usar ISO con zona horaria
explícita:

```text
2026-05-18T00:00:00+02:00
```

El orden válido es:

```text
public_start_at <= public_freeze_at <= final_deadline_at <= reveal_at
```

La validación tolera valores `null`, igual que las restricciones de base de
datos.

## Temporada, juego y semana

- Una temporada agrupa semanas y membresías de jugadores.
- Un juego pertenece al catálogo global.
- Una semana conecta una temporada con un juego, define fechas, reglas y estado
  de competición.

## Pendiente

No se implementa todavía:

- borrado de semanas;
- subida de manuales;
- ZIPs o descargas configuradas;
- configuraciones MAME;
- Storage;
- capturas reales;
- medallas;
- plugin MAME;
- app local.
