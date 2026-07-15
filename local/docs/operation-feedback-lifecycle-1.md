# OPERATION-FEEDBACK-LIFECYCLE-1

`operation-feedback.js` centraliza el ciclo de vida de overlays transitorios.
El default es 600 ms y se calcula solo el tiempo restante desde `startedAt`.
Una operacion lenta no recibe espera adicional.

`runWithOperationFeedback` asigna `runId`, ejecuta la operacion, aplica el
minimo tanto en exito como error y solo finaliza si `isCurrent` conserva la
identidad. Soporta hooks de inicio/fin para composicion y nesting.

Scopes:

- `transient`: 600 ms por defecto;
- `interactive`: 0 ms para dialogos y selectores nativos;
- `external`: 0 ms para MAME/shell;
- `background`: 0 ms y sin overlay.

Arranque, login, cambio de cuenta, refresh manual, activacion, reescaneo,
diagnostico y operaciones visibles usan la infraestructura comun. El
diagnostico muestra `Creando diagnostico...`. Busy global impide dos clicks
simultaneos; las guardas de runId impiden que una operacion vieja cierre una
nueva. Heartbeat, Ranking batch y autoenvio permanecen silenciosos.
