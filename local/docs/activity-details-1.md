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

## Actualizacion LOCAL-LAUNCHER-SHELL-BUGFIX-3

El drawer de actividad separa cabecera y cuerpo scrolleable. Los clicks dentro
del drawer ya no lo cierran accidentalmente, de modo que `Subir pendientes`,
detalles y `Restaurar a pendientes` siguen siendo usables.

## Actualización LOCAL-LAUNCHER-VISUAL-FOUNDATION-1

Actividad local deja de ser una tarjeta externa grande de la primera capa y se
integra como subtarjeta compacta dentro del detalle del pack.

La primera capa ya no muestra totales del tipo `0 pendientes · 6 enviadas · 0
errores`. En su lugar muestra:

- `Sincronizado`: todo al día, sin puntuaciones pendientes;
- `Pendiente de sincronizar`: quedan puntuaciones por subir;
- `Requiere atención`: hay puntuaciones con error.

`Ver detalles >` sigue abriendo el drawer de actividad. Allí continúan
disponibles `Subir pendientes`, pendientes, enviadas, `Puntuaciones con error`
y `Restaurar a pendientes`, sin mezclar scopes y sin mostrar JSON crudo ni
tokens.
