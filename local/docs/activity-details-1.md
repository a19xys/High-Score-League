# LOCAL-ACTIVITY-DETAILS-1

La primera capa muestra totales de pendientes, enviadas y `Puntuaciones con
error`, además del estado de auto-sync. `Ver detalles de actividad` despliega
los eventos del scope activo y mantiene disponibles:

- `Subir pendientes`;
- detalle de errores;
- `Restaurar a pendientes`.

La lectura sigue usando la cola separada por cuenta y pack. No mueve eventos
entre scopes y no muestra JSON crudo ni tokens.

