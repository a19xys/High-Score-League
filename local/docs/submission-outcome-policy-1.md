# LOCAL SUBMISSION OUTCOME POLICY 1

Politica canonica de resultados para CLI y autoenvio de puntuaciones.

| Resultado | Cola | Reintento | Terminal |
| --- | --- | --- | --- |
| `success` / `duplicate` | mover a `sent` | no | si |
| `auth-required` (401) | conservar `pending` | tras nueva revision de sesion | no |
| `terminal-failure` (400/403/409 no duplicado) | mover a `failed` | manual | si |
| `retryable-http` (408/425/429/5xx) | conservar `pending` | automatico | no |
| `transport-failure` / `timeout` | conservar `pending` | automatico | no |
| `cancelled` | conservar `pending` | nuevo contexto | no |
| `attention-required` (otro 4xx o respuesta inesperada) | conservar `pending` | requiere revision | si, estable |

Todos los resultados exponen `outcome`, `ok`, `httpStatus`, `preservePending`,
`retryable`, `authRequired`, `terminal`, `retryAfterMs`, `playerMessage` y
`technicalReason`. `ok` solo es verdadero para exito logico o duplicado.

## Cadencia

El coordinador aplica 30, 60, 120, 300 y 900 segundos. `Retry-After` acepta
segundos enteros o fecha HTTP; el valor efectivo nunca baja de 5 segundos ni
supera 15 minutos. Valores negativos, caducados, invalidos o superiores al
limite se ignoran y se usa el backoff local.

Durante cooldown, los disparadores repetidos no hacen red. La clave estable de
guards es `userId + queueRevision + sessionRevision`: una revision de cola,
cuenta o sesion cambia la clave y vuelve a evaluar. La
`reachabilityGeneration` forma parte solo de la identidad de ejecucion para
rechazo stale y diagnostico; offline/online, focus/blur, heartbeat, recovery y
suspend/resume no reinician cooldown, `retryAttempt`, `nextEligibleAt` ni auth
block. Un 401 bloquea solo la misma revision de sesion. La accion forzada de
desarrollo puede cancelar el run y resetear los guards explicitamente; no
existe override para produccion. Un reinicio completo del proceso sigue siendo
la excepcion porque estos guards no se persisten.

`terminalKey` solo se asigna cuando el resultado declara `terminal: true`.
Cancelacion, transporte, timeout y HTTP reintentable nunca la consumen.
`cancelCurrentRun` invalida resultados en vuelo sin borrar guards;
`resetGuards` borra terminalidad, cooldown y auth block y registra el motivo.

## Multi-cuenta

Las cuentas se procesan secuencialmente y cada scope conserva su identidad y
sesion canonica resuelta por el repositorio comun. Un 401 en una cuenta no impide probar la siguiente. Un fallo global de
transporte, HTTP reintentable o cancelacion detiene el ciclo para evitar una
tormenta. Los agregados propagan autenticacion, reintento, atencion, timeout,
cancelacion y `Retry-After`; no pueden declarar exito si queda un resultado
diferido.
