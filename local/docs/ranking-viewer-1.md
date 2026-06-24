# LOCAL-RANKING-VIEWER-1

No existe un endpoint local público y estable para consumir el ranking como
JSON. Por tanto, esta fase no inventa un contrato.

`Ver ranking` usa:

1. `metadata.rankingUrl` si es una URL `http(s)` válida;
2. la ruta web existente `/weeks/<weekId>` construida desde `webBaseUrl`.

Si no existe ninguno de los dos datos, muestra `Ranking integrado pendiente`.
La futura integración de datos queda para `WEB-LOCAL-RANKING-API-1` y
`LOCAL-RANKING-VIEWER-2`.

