# Clasificacion de temporada

La clasificacion real de temporada sale de `weekly_results`, no de
`submissions` vivas.

Esto significa que una puntuacion enviada durante una semana puede aparecer en
el leaderboard semanal vivo, pero no cuenta para la temporada hasta que un admin
genera resultados oficiales para esa semana.

## Datos usados

Para una temporada se leen:

- `seasons`;
- `weeks` de esa temporada;
- `weekly_results` de esas semanas;
- `profiles` de los jugadores;
- `season_memberships` para incluir miembros activos con 0 puntos.

La tabla tambien incluye cualquier jugador que tenga `weekly_results` en la
temporada aunque por algun motivo no aparezca como miembro activo.

## Jugadores con 0 puntos

Los miembros activos de `season_memberships` aparecen aunque todavia no tengan
resultados oficiales:

- puntos: 0;
- primeros: 0;
- segundos: 0;
- terceros: 0.

Esto permite ver la lista real de inscritos antes de que haya varias semanas
publicadas.

## Criterios de orden

El orden competitivo es:

1. puntos totales descendente;
2. primeros puestos descendente;
3. segundos puestos descendente;
4. terceros puestos descendente.

Si dos o mas jugadores empatan en todos esos criterios, comparten posicion.

Se usa ranking de competicion:

```text
1, 2, 2, 4
```

No se usa ranking denso:

```text
1, 2, 2, 3
```

`username` se usa solo como orden visual estable dentro de un empate. No rompe
el empate competitivo ni cambia la posicion compartida.

## Movimiento de posicion

`positionChange` se calcula comparando la clasificacion actual con una
clasificacion anterior que excluye la ultima semana con resultados oficiales.

Si no hay suficientes semanas con `weekly_results`, se muestra sin cambio.

## Podio

El podio de `/seasons/[seasonId]` usa la clasificacion real cuando existen
`weekly_results`.

El componente mantiene soporte visual para empates:

- varios primeros aparecen como `#1`;
- dos segundos aparecen como `#2`;
- no se crean huecos artificiales de posiciones inexistentes.

## Pendiente

- Medallas.
- Bonus.
- Panel admin completo.
- Cambios de estado de semana desde UI.
- Clasificacion global multi-temporada.
