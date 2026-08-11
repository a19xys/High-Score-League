# LOCAL SUBMISSION OUTCOME POLICY 1

Politica canonica de resultados para CLI y autoenvio de puntuaciones.

| Resultado | Cola | Reintento | Terminal |
| --- | --- | --- | --- |
| `success` / `duplicate` | mover a `sent` | no | si |
| `auth-required` (401 tras refresh canonico revocado) | conservar `pending` | tras nueva revision de sesion | no |
| `rejected-domain` (codigo competitivo conclusivo) | mover a `rejected` interno | no | si |
| `ambiguous-http` (403/404/409 sin codigo) | conservar `pending` | automatico prudente | no |
| `retryable-http` (408/425/429/5xx) | conservar `pending` | automatico | no |
| `transport-failure` / `timeout` | conservar `pending` | automatico | no |
| `cancelled` | conservar `pending` | nuevo contexto | no |
| `attention-required` (conflicto/politica/respuesta imposible) | mover a `failed` | revision manual | si |

Todos los resultados exponen `outcome`, `ok`, `httpStatus`, `preservePending`,
`retryable`, `authRequired`, `terminal`, `retryAfterMs`, `playerMessage` y
`technicalReason`. `ok` solo es verdadero para exito logico o duplicado.
`rejected` conserva el JSON y una nota saneada, pero queda fuera de Actividad,
conteos y reintentos. Un primer 401 fuerza una unica renovacion canonica y un
segundo 401 conserva `pending` sin bucle.

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
