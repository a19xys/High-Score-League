# Administracion minima

El panel admin minimo sirve para gestionar el flujo semanal sin SQL manual. No
sustituye todavia a un panel completo de usuarios, medallas, Storage ni MAME.

## Acceso

El centro admin aparece en `/profile` solo si el perfil real del usuario tiene:

```sql
is_admin = true
```

La UI oculta el centro a usuarios normales, pero todas las rutas y endpoints
admin vuelven a comprobar `is_admin` en servidor.

## Centro admin en `/profile`

El bloque de administracion contiene:

- Semana actual.
- Todas las semanas.
- Temporadas, enlazando a `/admin/seasons`.
- Juegos, enlazando al catalogo real en `/admin/games`.
- Usuarios como placeholder.

`Publicar resultados` y `Revisar submissions` no son tarjetas separadas porque
pertenecen a una semana concreta. Se gestionan desde `/admin/weeks/[weekId]`.

## Semana actual

`/admin/weeks/current` resuelve la semana real activa por fechas:

- si hay una sola semana activa, redirige a `/admin/weeks/[weekId]`;
- si no hay semana activa, redirige a `/admin/weeks`;
- si hay varias semanas activas, redirige a `/admin/weeks` para revisar la
  configuracion.

## Todas las semanas

`/admin/weeks` lista semanas reales con temporada, numero, juego, estado,
fechas, submissions, invalidas, resultados oficiales y enlace a gestionar.

Tambien incluye el boton `Crear semana`, que abre `/admin/weeks/new`.

## Juegos

`/admin/games` gestiona el catalogo real de juegos. Permite listar, buscar,
crear y editar juegos. La edicion de juegos no borra entradas para no romper
semanas existentes.

## Temporadas

`/admin/seasons` gestiona temporadas reales. Permite listar, buscar, crear y
editar temporadas. Crear una temporada no crea semanas automaticamente.

Los estados de temporada se sincronizan por fechas:

- antes de inicio: `draft`;
- entre inicio y fin: `active`;
- tras fin: `completed`.

## Crear y editar semanas

`/admin/weeks/new` crea semanas reales asociando temporada, juego, numero,
apertura, tramo final opcional, cierre y reglas resumidas.

`/admin/weeks/[weekId]/edit` edita esos mismos datos principales y separa la
edicion de metadatos del cuadro de mandos operativo.

La edicion de semanas incluye gestion basica de benchmarks visuales. Los
benchmarks no son submissions y no afectan a puntos ni resultados oficiales.

## Estados de semana

El admin ya no elige estados manualmente desde la UI. Las semanas se sincronizan
por fechas:

- antes de apertura: `draft`;
- apertura normal: `active`;
- tramo final: `frozen`;
- cierre procesado: `published`.

El endpoint `/api/cron/process-schedule` actualiza estados y genera
`weekly_results` al cierre. Consulta `docs/automation.md`.

## Gestion de una semana

`/admin/weeks/[weekId]` muestra:

- temporada, semana, juego y estado;
- fechas principales;
- benchmarks activos;
- leaderboard vivo desde submissions visibles;
- submissions reales de la semana;
- `weekly_results` oficiales si existen;
- acciones admin de revision y resultados.

La UI conserva preview y regeneracion de resultados como herramienta de
emergencia, pero no muestra botones manuales para cambiar estado.

## Revision de submissions

`PATCH /api/admin/submissions/[submissionId]` permite marcar una submission como
valida o invalida. No permite borrar submissions, cambiar score, cambiar jugador
ni tocar capturas o Storage.

## Resultados oficiales

`POST /api/admin/weeks/[weekId]/weekly-results` permite:

- `dryRun: true`: preview sin escribir.
- `dryRun: false`: regenerar resultados oficiales si la semana ya esta cerrada
  por fechas o publicada.

La publicacion normal ocurre por cron. Al llegar el cierre, el sistema genera
`weekly_results` y marca la semana como `published`.

## Cuentas de prueba

La opcion actual de borrar cuenta se mantiene como herramienta de desarrollo.

En produccion, borrar cuenta deberia sustituirse por desactivar y anonimizar el
usuario para no romper competiciones pasadas o en curso.

## Pendiente

- Panel completo de usuarios.
- Creacion avanzada de semanas con manuales, descargas y configuracion MAME.
- Medallas.
- Storage y capturas.
- Plugin MAME y app local.
