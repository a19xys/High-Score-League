# Weekly results

`weekly_results` guarda el resultado oficial publicado de una semana. Se genera
desde `submissions` reales, pero no sustituye al leaderboard vivo hasta que un
admin decide publicar o regenerar resultados.

## Membresías de temporada

La migración `supabase/migrations/0003_season_memberships_and_results.sql` crea
`public.season_memberships`.

Cada fila une un `profile` con una `season`:

- `season_id`
- `player_id`
- `status`: `active` o `left`
- `joined_at`

Un usuario autenticado puede unirse a una temporada `active` con su propio
usuario. No puede unir a otros jugadores. Los admins pueden gestionar todas las
membresías.

Por ahora se permite unirse a una temporada activa aunque ya haya empezado. El
jugador que entre tarde empieza con 0 puntos previos. Esta regla podrá
endurecerse más adelante si se cierran inscripciones tras la primera semana.

## Elegibilidad por semana

Para calcular resultados de una semana, `M` no es el número de miembros activos
actuales de la temporada, sino el número de miembros elegibles para esa semana.

Un miembro es elegible si:

1. Pertenece a la temporada de la semana.
2. Tiene `status = active`.
3. Su `joined_at` es anterior o igual al corte competitivo de la semana.

El corte competitivo se calcula con el primer valor disponible en este orden:

1. `final_deadline_at`.
2. `reveal_at`.
3. `public_freeze_at`.
4. `public_start_at`.
5. `now()` como fallback técnico si faltan todas las fechas.

Esto evita que un jugador que se une tarde altere los puntos de semanas
anteriores si un admin regenera `weekly_results`.

## Cálculo semanal

Para generar resultados de una semana:

1. Leer la semana y su temporada.
2. Leer miembros activos elegibles de esa temporada.
3. Leer submissions de esa semana.
4. Considerar solo submissions de miembros elegibles.
5. Considerar solo submissions con `is_valid = true`.
6. Para cada jugador, elegir su mejor score.
7. Si un jugador tiene varias submissions con el mismo mejor score, usar la
   primera enviada.
8. Ordenar por score descendente, `submitted_at` ascendente y luego username o
   `player_id` como desempate técnico estable.

Los jugadores sin submission válida esa semana no reciben fila en
`weekly_results` y suman 0 puntos.

Los benchmarks visuales de `week_benchmarks` no participan en este cálculo. No
cuentan para `M`, no generan filas en `weekly_results` y no alteran ranks ni
puntos.

## Desempate semanal

En una semana no hay empate competitivo si dos jugadores tienen la misma
puntuación. Gana quien envió antes la submission.

Este desempate solo afecta al ranking semanal. En la clasificación de temporada,
los empates se resuelven con puntos, primeros, segundos y terceros, sin
desempate oculto.

## Puntos para N jugadores

Sea `M` el número de miembros elegibles de la semana al generar resultados.

Si `M = 1`:

- Rank 1: 1 punto.

Si `M = 2`:

- Rank 1: 4 puntos.
- Rank 2: 1 punto.

Si `M >= 3`:

- Rank 1: `M + 3`.
- Rank 2: `M`.
- Rank 3: `M - 2`.
- Rank 4: `M - 3`.
- Rank 5: `M - 4`.
- Continúa hasta el último puesto puntuado.

Ejemplo con `M = 12`:

| Rank | Puntos |
| ---: | -----: |
| 1 | 15 |
| 2 | 12 |
| 3 | 10 |
| 4 | 9 |
| 5 | 8 |
| 6 | 7 |
| 7 | 6 |
| 8 | 5 |
| 9 | 4 |
| 10 | 3 |
| 11 | 2 |
| 12 | 1 |

La lógica del podio queda:

- El tercero tiene 1 punto más que el cuarto.
- El segundo tiene 2 puntos más que el tercero.
- El primero tiene 3 puntos más que el segundo.

No hay medallas ni bonus de 0.5 todavía.

## Endpoint admin

Endpoint mínimo:

```text
POST /api/admin/weeks/[weekId]/weekly-results
```

Requiere:

- sesión Supabase;
- `profiles.is_admin = true`;
- no usa `service_role`.

### Dry run

```json
{
  "dryRun": true
}
```

Calcula y devuelve preview sin escribir en `weekly_results`. Se permite si la
semana está `closed` o `published`.

La respuesta incluye `cutoffAt`, para poder auditar qué fecha se usó al calcular
miembros elegibles.

### Generar resultados

```json
{
  "dryRun": false
}
```

Solo se permite si la semana está `closed` o `published`. Borra resultados
anteriores de esa semana, inserta los nuevos de forma controlada y marca la
semana como `published`.

Si no hay miembros elegibles, devuelve error. Si no hay submissions válidas,
puede guardar una lista vacía, eliminando resultados anteriores de esa semana.

## UI admin mínima

`/admin/weeks/[weekId]` permite ejecutar el mismo flujo desde la interfaz:

1. `Preview resultados` ejecuta `dryRun = true`.
2. `Publicar resultados oficiales` ejecuta `dryRun = false`.
3. Si la semana ya está `published`, la acción permite regenerar resultados de
   forma manual.

La publicación queda como acción explícita: el cron solo cierra la semana y
revela puntuaciones; `weekly_results` se generan cuando el admin publica.

## Pendiente

- Panel admin completo de temporadas, juegos y usuarios.
- Automatizar publicación en un único flujo transaccional si se decide más
  adelante.
- Medallas.
- Capturas y Storage.
- Plugin MAME y app local.
