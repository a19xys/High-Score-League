# LOCAL-ACTIVITY-DETAILS-1

La primera capa muestra totales de pendientes, enviadas y `Puntuaciones con
error`, además del estado de auto-sync. `Ver detalles de actividad` despliega
los eventos del scope activo y mantiene disponibles:

- `Subir pendientes`;
- detalle de errores;
- `Restaurar a pendientes`.

La lectura sigue usando la cola separada por cuenta y pack. No mueve eventos
entre scopes y no muestra JSON crudo ni tokens.

## Actualizacion LOCAL-LAUNCHER-SHELL-LAYOUT-2

La primera capa queda aun mas compacta: muestra estado de auto-sync y totales
`pendientes · enviadas · errores`. `Ver detalles` abre un drawer lateral que
contiene `Subir pendientes`, pendientes, `Puntuaciones con error`, restauracion
a pendientes y detalles tecnicos del scope activo.
