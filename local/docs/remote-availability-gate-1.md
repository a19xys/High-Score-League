# REMOTE AVAILABILITY GATE 1

`deriveRemoteAvailability(connectivity)` es la compuerta visual canonica:

- reachability connected: disponible;
- reachability offline: no disponible;
- reachability unknown: pendiente/oculta segun el control.

No usa `displayStatus`, `net.isOnline`, `navigator.onLine`, fase de probe ni
inFlight. Mientras health comprueba una posible perdida se conserva el ultimo
estado comprometido. Tras confirmar offline o connected, todos los controles se
actualizan desde el mismo snapshot y en el mismo render.

Matriz actual:

| Control | Clase | Compuerta HSL | Blockers propios |
| --- | --- | --- | --- |
| Ranking | A remota | Si | weekId, capability, URL y pack actual |
| Login | A remota | Si | formulario valido y busy |
| Comprobar temporada | A remota | Si | sesion, weekId y busy |
| Autoenvio / force sync | A remota | Si | cuenta, cola, locks y membership |
| Comprobar conexion | Especial | Mantiene estado previo | un probe concurrente |
| Abrir temporada | B navegador | No | URL segura |
| Manual y practica | C local | No | archivo/runtime/readiness |
| Competicion | D hibrida | No como UI web | sesion, membership y readiness |

Futuros controles como Instalar o Actualizar pack deben usar
`remoteAvailability.available` mas sus blockers de compatibilidad. No deben
interpretar conectividad por separado.
