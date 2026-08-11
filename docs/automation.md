# Automatizacion de calendario

High Score League deriva en las vistas el estado actual de las semanas a partir
de sus fechas. Además, sincroniza estados persistidos y efectos laterales
mediante un endpoint cron protegido:

```text
POST /api/cron/process-schedule
```

## Seguridad

El endpoint requiere:

```http
Authorization: Bearer CRON_SECRET
```

`CRON_SECRET` debe existir en `.env.local` y en el entorno del despliegue. No se
incluye ningun valor real en el repositorio.

El endpoint usa `SUPABASE_SERVICE_ROLE_KEY` solo en servidor para procesar todas
las semanas y temporadas. No se usa `service_role` en frontend.

## Frecuencia recomendada

Ejecutar cada 5 o 10 minutos con Vercel Cron o un servicio equivalente.

Ejemplo conceptual:

```text
*/10 * * * * POST /api/cron/process-schedule
```

## Semanas

El cron procesa semanas con `public_start_at` y `final_deadline_at`:

- antes de apertura: `draft`;
- desde apertura hasta tramo final: `active`;
- desde tramo final hasta cierre: `frozen`;
- al llegar al cierre: marca `closed` y revela submissions válidas ocultas;
- si ya está `published`, mantiene `published`.

El tramo final usa `public_freeze_at`. Si no existe, la semana pasa de
`active` a cierre directamente.

El cron reutiliza la reconciliación de semana para semanas no publicadas: ajusta
el estado por fechas, recalcula `is_hidden` de submissions válidas y revela
puntuaciones al cerrar. Las semanas ya `published` se omiten. La edición admin
usa el mismo helper y, si un cambio de fechas reabre una semana con resultados,
retira sus `weekly_results` para que deje de contar hasta una nueva publicación.

El cron no genera `weekly_results`. La publicación oficial queda como acción
manual de admin desde `/admin/weeks/[weekId]`. Esto separa:

- `closed`: puntuaciones reveladas, sin submissions nuevas, sin contar para
  clasificación de temporada;
- `published`: `weekly_results` generados y semana contabilizada oficialmente.

El endpoint es idempotente: ejecutarlo varias veces no duplica resultados y
omite las semanas `published`.

La UI pública y administrativa usa el mismo calendario derivado para mostrar el
estado vigente aunque la última ejecución del cron todavía no haya persistido
el cambio. El cron sigue siendo necesario para actualizar filas y reconciliar
`is_hidden`; la edición admin usa el helper compartido para retirar resultados
si reabre una semana. El cron no es la única fuente del estado visual.

## Temporadas

El cron procesa temporadas con `starts_at` y `ends_at`:

- antes de inicio: `draft`;
- entre inicio y fin: `active`;
- tras fin: `completed`.

Temporadas sin fechas completas se consideran configuracion incompleta y no se
procesan automaticamente.

Las lecturas de temporadas también derivan el estado desde las fechas para la
UI; el cron persiste esa misma decisión en `seasons.status`.

## Prueba local

Con el servidor local arrancado:

```powershell
$env:CRON_SECRET="un-secreto-local"
Invoke-WebRequest `
  -Uri "http://localhost:3000/api/cron/process-schedule" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -UseBasicParsing
```

Tambien deben estar configuradas:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

## Pendiente

No hay todavía una configuración de Vercel Cron versionada en el repositorio.
Debe configurarse operativamente este endpoint, o un programador equivalente,
sin convertirlo en la siguiente prioridad de producto por encima del roadmap de
perfiles.
