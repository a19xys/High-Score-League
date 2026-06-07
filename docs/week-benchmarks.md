# Week benchmarks

Los benchmarks de semana son referencias visuales dentro del leaderboard.
Sirven para comunicar niveles orientativos, por ejemplo puntuación media,
avanzada o experta.

No son submissions reales:

- no tienen jugador;
- no tienen perfil;
- no cuentan para puntos;
- no generan `weekly_results`;
- no afectan a `M`;
- no aparecen en historial de envíos;
- no afectan a la clasificación de temporada.

## Tabla

La migración `supabase/migrations/0004_week_benchmarks.sql` crea
`public.week_benchmarks`.

Campos principales:

- `week_id`
- `label`
- `score`
- `description`
- `icon_key`
- `sort_order`
- `is_active`

La migración `supabase/migrations/0019_week_benchmark_icon_key.sql` añade
`icon_key`. Valores permitidos:

- `speedometer_1`
- `speedometer_2`
- `speedometer_3`

Los usuarios autenticados pueden leer benchmarks activos. Solo admins pueden
gestionarlos.

En la UI admin se editan etiqueta, puntuación, descripcion e icono. Si no se elige icono, se guarda `speedometer_3`.

## Orden visual

El leaderboard mezcla jugadores y benchmarks por puntuación descendente.

Si un benchmark y un jugador tienen la misma puntuación, el jugador aparece
primero. Entre benchmarks con la misma puntuación, se usa `sort_order` y luego
`label` como orden estable.

## SQL de prueba

Sustituye `WEEK_ID` por el id real de la semana:

```sql
insert into public.week_benchmarks (
  week_id,
  label,
  score,
  description,
  icon_key
) values
  (
    'WEEK_ID',
    'Puntuacion media',
    10000,
    'Referencia orientativa para una partida consistente.',
    'speedometer_1'
  ),
  (
    'WEEK_ID',
    'Puntuación avanzada',
    30000,
    'Buen dominio de patrones y riesgo controlado.',
    'speedometer_2'
  ),
  (
    'WEEK_ID',
    'Puntuación experta',
    75000,
    'Nivel alto para competir por los primeros puestos.',
    'speedometer_3'
  )
on conflict (week_id, label) do update
set
  score = excluded.score,
  description = excluded.description,
  icon_key = excluded.icon_key,
  is_active = true;
```

Para eliminar una referencia desde la web, usa el botón `Eliminar` en
`/admin/weeks/[weekId]/edit`. Si quieres hacerlo manualmente en desarrollo:

```sql
delete from public.week_benchmarks
where week_id = 'WEEK_ID'
  and label = 'Puntuación media';
```
