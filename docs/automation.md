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
- al llegar al cierre: genera `weekly_results` y marca `published`;
- si ya esta `published`, no regenera resultados.

El tramo final usa `public_freeze_at`. Si no existe, la semana pasa de
`active` a cierre directamente.

La generacion es idempotente: si la semana ya tiene resultados oficiales o esta
`published`, el cron no crea duplicados. Si no hay submissions validas pero hay
miembros elegibles, se publican resultados vacios. Si no hay miembros elegibles,
la semana queda `closed` y el resultado del cron incluye el error.

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
