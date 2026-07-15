# LOCAL-CONNECTIVITY-STATE-1

La conectividad del launcher tiene una unica fuente de verdad en el proceso
principal de Electron. El renderer solo presenta el snapshot y puede solicitar
una reevaluacion; `navigator.onLine` nunca confirma que HSL responda.

## Estado estable y probe

El estado separa dos conceptos:

- `reachability`: ultimo resultado estable (`unknown`, `connected`, `offline`);
- `probe`: comprobacion actual (`idle`, `startup`, `manual`, `retry`,
  `background`), con `inFlight` y `startedAt`.

`deriveConnectivityDisplayState` es el unico selector visual:

| Reachability | Probe real | Estado visible |
| --- | --- | --- |
| unknown | startup | Conectando |
| offline | retry o manual | Reconectando |
| connected | manual | Reconectando |
| connected | background | Conectado |
| connected | idle | Conectado |
| offline | idle | Desconectado |

`Conectando` implica siempre `startup + inFlight`; `Reconectando` implica
siempre `manual/retry + inFlight`. Un fallo finaliza el probe y deja
`reachability=offline`, incluso mientras espera el siguiente backoff.

## Politica de comprobaciones

El health check usa `net.fetch` con `GET /api/launcher/health`, `cache:
no-store`, redirecciones manuales y `AbortController`. Solo acepta un `204` del
mismo origen configurado. No envia sesion, cookies ni tokens.

Valores:

- timeout: 4 segundos;
- conectado: mantenimiento cada 5 minutos;
- focus/resume: probe de fondo si el resultado tiene mas de 90 segundos;
- sin interfaz: reintento cada 60 segundos;
- backoff: 5, 15, 30, 60, 120 y 300 segundos, con jitter de +/-15 %.

El arranque crea un unico probe `startup`. Los probes periodicos, de foco y de
resume son `background`: mientras estan en curso el chip sigue en Conectado y
Ranking puede usar una capacidad vigente. Un fallo pasa directamente a
Desconectado.

Desde offline, el backoff solo muestra Reconectando durante la peticion real.
`nextRetryAt` no implica que haya una peticion activa. El refresco manual fuerza
o reutiliza el probe actual, lo eleva a fase `manual`, evita solicitudes
duplicadas y muestra Reconectando.

Las operaciones locales, incluida la seleccion de pack, no lanzan probes
visibles. Una accion remota usa health reciente o inicia mantenimiento de fondo.
Una respuesta HTTP valida de HSL puede confirmar reachability aunque el producto
responda 400, 401, 403, 404 o 503. Solo un fallo de transporte solicita una
reevaluacion.

## Senales de sistema e IPC

`net.isOnline() === false` establece offline inmediatamente. Un valor `true`
solo permite intentar el health check: Windows puede conservar adaptadores
virtuales o interfaces logicas sin salida a HSL.

- `launcher:get-connectivity-state`
- `launcher:request-connectivity-refresh`
- evento `launcher:connectivity-state`

Los motivos del renderer se limitan a `manual`, `renderer-online` y
`renderer-offline`. Cada invalidacion incrementa una generacion; respuestas
anteriores no pueden sustituir un estado mas nuevo.

## Diagnostico

El informe incluye `reachability`, `displayStatus`, `probe.phase`,
`probe.inFlight`, `startedAt`, `checkedAt`, `changedAt`, `reason`, `source`,
latencia, siguiente reintento, fallos consecutivos, `netIsOnline`, generacion y
origen normalizado. Nunca incluye tokens, cookies, cabeceras o cuerpos sensibles.

