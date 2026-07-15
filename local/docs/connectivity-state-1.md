# LOCAL-CONNECTIVITY-STATE-1

La conectividad tiene una unica fuente de verdad en Electron main. El renderer
solo presenta snapshots y envia señales; `navigator.onLine` y
`net.isOnline() === true` nunca confirman acceso a HSL.

## Modelo

- `reachability`: `unknown`, `connected` u `offline`.
- `probe`: fases internas `startup`, `manual`, `retry` y `background`.
- `reachabilityGeneration`: invalida respuestas remotas antiguas.
- `deploymentGeneration`: invalida cache de Ranking al cambiar build/contrato.
- `activity`: `active`, `background` o `suspended`.

`deriveConnectivityDisplayState` se conserva para diagnostico y compatibilidad.
El header usa `deriveConnectivityHeaderState`: oculta `unknown` y solo presenta
`Conectado` o `Desconectado`. Un probe manual mantiene el texto estable y deja
el boton refresh visible pero deshabilitado.

## Señales y probes

El coordinador recibe `online`, `offline`, el cambio opcional de
`navigator.connection`, `net.isOnline()`, focus/blur, suspend/resume, fallos de
transporte, refresh manual, heartbeat y retry. Ningun consumidor hace health
por su cuenta.

- Señal negativa fuerte: offline inmediato, aborto del probe viejo y retry.
- Señal positiva: debounce de 150 ms y un unico health compartido; nunca asigna
  connected antes del 204.
- HTTP de HSL, incluido 503: confirma reachability.
- Fallo aislado de heartbeat: segundo intento inmediato dentro de la misma
  operacion; solo dos fallos consecutivos establecen offline.

Health usa `net.fetch`, mismo origen, redireccion manual, `cache: no-store`, body
vacio y contrato 1. No envia sesion ni cookies.

Valores medidos y elegidos el 15-07-2026:

- 8 muestras de produccion: min 169 ms, mediana 181 ms, p95/max 2215 ms;
- timeout: 3000 ms;
- connected activo: 45 s;
- connected segundo plano: 4 min;
- suspendido: sin polling;
- backoff offline: 5, 15, 30, 60, 120 y 300 s, jitter +/-15 %;
- `net.isOnline=false`: fast path, con retry de seguridad a 60 s.

## Ciclo de vida y diagnostico

Los listeners tienen funciones nominadas y cleanup (`removeListener`,
`beforeunload`). Un cambio de `webBaseUrl` aborta health, borra fingerprint,
invalida generaciones y consulta el nuevo origen. Resume no confia en timers
dormidos y solicita health inmediato.

El diagnostico incluye señal/fuente, reachability, probe, latencia, timeout,
heartbeat, actividad, retry, generaciones y fingerprint. Nunca incluye tokens,
cookies ni cuerpos remotos.
