# LOCAL-CONNECTIVITY-STATE-1

La conectividad del launcher tiene una unica fuente de verdad: el proceso
principal de Electron. El renderer presenta el estado y puede pedir una
reevaluacion, pero nunca confirma por si mismo que High Score League responde.

## Estados

- `offline` / `Desconectado`: `net.isOnline()` informa que no hay una interfaz
  de red utilizable.
- `connecting` / `Conectando`: existe una posible red, pero HSL todavia no ha
  respondido correctamente o la comprobacion fallo de forma temporal.
- `connected` / `Conectado`: una respuesta reciente de HSL ha confirmado
  reachability.

`net.isOnline()` es solo una senal previa. Un valor `true` nunca establece
`connected`. `navigator.onLine` no es fuente de estado; sus eventos `online` y
`offline` solo solicitan una reevaluacion al proceso principal.

## Health check

El coordinador usa `net.fetch` con `GET /api/launcher/health`, `cache: no-store`,
redirecciones manuales y `AbortController`. Solo acepta `204` procedente del
mismo origen configurado. No envia sesion, cookies HSL de la web ni tokens del
jugador.

Valores iniciales:

- timeout: 4 segundos;
- resultado conectado: comprobacion periodica cada 5 minutos;
- focus: solo comprueba si el ultimo resultado tiene mas de 90 segundos;
- offline: reintento cada 60 segundos;
- backoff: 5, 15, 30, 60, 120 y 300 segundos;
- jitter: +/-15 % sobre cada tramo de backoff.

Las peticiones concurrentes comparten el mismo `Promise`. Cada cambio de
`webBaseUrl`, perdida de red o cierre incrementa la generacion y aborta o
descarta respuestas anteriores. Los timers y listeners se eliminan en
`before-quit`.

## Disparadores

- arranque, despues de `app.whenReady()`;
- vencimiento del intervalo o backoff;
- cambio real de `webBaseUrl`;
- `resume` de `powerMonitor`;
- foco si el resultado esta stale;
- senales `online`/`offline` del renderer;
- accion remota con salud no reciente;
- fallo de transporte observado por membership o ranking capabilities.

No se comprueba en cada render, cambio de vista o seleccion local. Una
respuesta HTTP valida de una accion HSL confirma reachability aunque su
resultado sea 401, membership denegada o validacion de producto. Esos errores
no significan falta de red. Solo la ausencia de respuesta por transporte pide
una nueva comprobacion.

## IPC

- `launcher:get-connectivity-state`
- `launcher:request-connectivity-refresh`
- evento `launcher:connectivity-state`

Los motivos aceptados desde renderer estan limitados a `manual`,
`renderer-online` y `renderer-offline`. Preload no expone `net.fetch` ni un
canal para URLs arbitrarias.

## Diagnostico

El diagnostico incluye estado, `netIsOnline`, endpoint health, timestamps,
motivo tecnico sanitizado, fuente, latencia, siguiente reintento, fallos
consecutivos, peticion en curso y `webBaseUrl` normalizado. No incluye tokens,
cookies, cabeceras Authorization ni cuerpos sensibles.

