# Week benchmarks

Los benchmarks de semana son referencias visuales dentro del leaderboard. Sirven
para comunicar niveles orientativos, por ejemplo puntuación media, avanzada o
experta.

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
`public.week_benchmarks`:

- `week_id`
- `label`
- `score`
- `description`
- `sort_order`
- `is_active`

Los usuarios autenticados pueden leer benchmarks activos. Solo admins pueden
gestionarlos.

En la UI admin actual se editan solo etiqueta, puntuación y descripción. Los
benchmarks nuevos se guardan activos y el orden visual se deriva de la
puntuación.

## Orden visual

El leaderboard mezcla jugadores y benchmarks por puntuación descendente.

Si un benchmark y un jugador tienen la misma puntuación, el jugador aparece
primero. Entre benchmarks con la misma puntuación, se usa `label` como orden
estable.

## SQL de prueba

Sustituye `WEEK_ID` por el id real de la semana:

```sql
insert into public.week_benchmarks (
  week_id,
  label,
  score,
  description
) values
  (
    'WEEK_ID',
    'Puntuación media',
    10000,
    'Referencia orientativa para una partida consistente.'
  ),
  (
    'WEEK_ID',
    'Puntuación avanzada',
    30000,
    'Buen dominio de patrones y riesgo controlado.'
  ),
  (
    'WEEK_ID',
    'Puntuación experta',
    75000,
    'Nivel alto para competir por los primeros puestos.'
  )
on conflict (week_id, label) do update
set
  score = excluded.score,
  description = excluded.description,
  is_active = true;
```

Para eliminar una referencia desde la web, usa el botón `Eliminar` en
`/admin/weeks/[weekId]/edit`. Si quieres hacerlo manualmente en desarrollo:

```sql
delete from public.week_benchmarks
where week_id = 'WEEK_ID'
  and label = 'Puntuación media';
```
