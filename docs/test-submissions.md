# Test submissions

Esta guía permite crear submissions de prueba manualmente en Supabase SQL Editor
para validar el leaderboard semanal real. No implementa subida desde la web,
endpoint de ingestión, Storage, plugin MAME ni app local.

## Pasos previos

1. Crea un usuario real desde `/register`.
2. Inicia sesión y confirma que existe su fila en `public.profiles`.
3. Copia el `id` del perfil desde Supabase Table Editor o SQL Editor.
4. Copia el `id` de una semana activa o publicada desde `public.weeks`.
5. Usa `screenshot_path = null`; las capturas son opcionales.

Ejemplo para localizar datos:

```sql
select id, username, initials
from public.profiles
order by created_at desc;

select id, week_number, status, public_start_at, final_deadline_at
from public.weeks
where status in ('active', 'frozen', 'published')
order by public_start_at desc;
```

## Submission visible

Sustituye los UUID por valores reales:

```sql
insert into public.submissions (
  week_id,
  player_id,
  score,
  screenshot_path,
  comment,
  is_hidden,
  is_valid,
  source,
  detected_at,
  rom_name,
  mame_version,
  client_version,
  raw_event,
  duplicate_key
) values (
  'WEEK_ID',
  'PLAYER_ID',
  184320,
  null,
  'Submission visible de prueba',
  false,
  true,
  'web',
  '2026-05-24T21:17:00+02:00',
  'galaga',
  null,
  null,
  '{"test": true, "eventType": "manual_sql"}'::jsonb,
  'test-WEEK_ID-PLAYER_ID-184320'
);
```

`submitted_at` no se indica porque la base de datos lo fuerza con el trigger de
servidor.

## Submission desde lectura de memoria MAME

```sql
insert into public.submissions (
  week_id,
  player_id,
  score,
  screenshot_path,
  comment,
  is_hidden,
  is_valid,
  source,
  detected_at,
  rom_name,
  mame_version,
  client_version,
  raw_event,
  duplicate_key
) values (
  'WEEK_ID',
  'PLAYER_ID',
  231900,
  null,
  'Evento simulado desde memoria MAME',
  false,
  true,
  'mame_memory',
  '2026-05-24T22:08:00+02:00',
  'galaga',
  '0.265',
  'hsl-local-0.1.0',
  '{"test": true, "eventType": "memory_score_detected"}'::jsonb,
  'test-WEEK_ID-PLAYER_ID-231900'
);
```

## Submission oculta

Las submissions ocultas no deben revelar puntuación antes de que la semana esté
`published`.

```sql
insert into public.submissions (
  week_id,
  player_id,
  score,
  screenshot_path,
  comment,
  is_hidden,
  is_valid,
  source,
  detected_at,
  duplicate_key
) values (
  'WEEK_ID',
  'PLAYER_ID',
  199000,
  null,
  'Oculta hasta publicación',
  true,
  true,
  'mame_memory',
  '2026-05-24T23:40:00+02:00',
  'test-hidden-WEEK_ID-PLAYER_ID-199000'
);
```

Con las políticas RLS actuales, un usuario normal solo leerá sus propias
submissions ocultas. Exponer metadatos de submissions ocultas de otros jugadores
sin revelar `score` requerirá una decisión posterior, porque RLS no oculta
columnas concretas.

## Submission inválida

```sql
insert into public.submissions (
  week_id,
  player_id,
  score,
  screenshot_path,
  comment,
  is_hidden,
  is_valid,
  source,
  detected_at,
  duplicate_key
) values (
  'WEEK_ID',
  'PLAYER_ID',
  1000,
  null,
  'Prueba inválida',
  false,
  false,
  'web',
  '2026-05-24T18:00:00+02:00',
  'test-invalid-WEEK_ID-PLAYER_ID-1000'
);
```

Las submissions inválidas no cuentan para el leaderboard.

## Borrar datos de prueba

Usa una condición restrictiva:

```sql
delete from public.submissions
where duplicate_key like 'test-%';
```

No borres filas sin filtrar por `duplicate_key`, `week_id` o `player_id`.
