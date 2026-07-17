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

Durante cooldown, los disparadores repetidos no hacen red. Una revision de
cola, cuenta, generacion de conectividad o sesion cambia la clave y vuelve a
evaluar. Un 401 bloquea solo la misma revision de sesion. La accion forzada de
desarrollo puede anular cooldown/bloqueo; no existe override para produccion.

`terminalKey` solo se asigna cuando el resultado declara `terminal: true`.
Cancelacion, invalidacion, transporte, timeout y HTTP reintentable nunca la
consumen.

## Multi-cuenta

Las cuentas se procesan secuencialmente y cada scope conserva su identidad y
sesion. Un 401 en una cuenta no impide probar la siguiente. Un fallo global de
transporte, HTTP reintentable o cancelacion detiene el ciclo para evitar una
tormenta. Los agregados propagan autenticacion, reintento, atencion, timeout,
cancelacion y `Retry-After`; no pueden declarar exito si queda un resultado
diferido.
