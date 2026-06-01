# Automatizacion de calendario

High Score League sincroniza estados internos de semanas y temporadas mediante
un endpoint cron protegido:

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

El cron reutiliza la reconciliación de semana: ajusta el estado por fechas,
recalcula `is_hidden` de submissions válidas, revela puntuaciones al cerrar y
retira `weekly_results` si una semana publicada fue reabierta al mover su cierre
al futuro.

El cron no genera `weekly_results`. La publicación oficial queda como acción
manual de admin desde `/admin/weeks/[weekId]`. Esto separa:

- `closed`: puntuaciones reveladas, sin submissions nuevas, sin contar para
  clasificación de temporada;
- `published`: `weekly_results` generados y semana contabilizada oficialmente.

El endpoint es idempotente: ejecutarlo varias veces no duplica resultados y no
cambia una semana `published` a `closed`.

## Temporadas

El cron procesa temporadas con `starts_at` y `ends_at`:

- antes de inicio: `draft`;
- entre inicio y fin: `active`;
- tras fin: `completed`.

Temporadas sin fechas completas se consideran configuracion incompleta y no se
procesan automaticamente.

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

No hay todavia:

- Vercel Cron configurado en el repositorio;
- medallas;
- Storage;
- capturas;
- plugin MAME;
- app local.
