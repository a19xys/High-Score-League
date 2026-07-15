# CONNECTIVITY STATE 1

Main es la autoridad de reachability. `net.isOnline`, eventos renderer y
`os.networkInterfaces()` son indicios; solo el health 204 del origen HSL
confirma `connected`. HTTP alcanzable con error de producto, incluido 503,
confirma reachability sin convertir el producto en disponible.

El header oculta `unknown` y solo muestra estados estables. Un probe manual
mantiene la etiqueta y deshabilita temporalmente refresh. El selector acepta
`null`, `undefined`, objeto vacio y estados parciales.

Politica desde BACKGROUND-MONITOR-4:

- topologia local cada 1000 ms, sin trafico de red;
- heartbeat conectado cada 20 s, enfocada, desenfocada o minimizada;
- health timeout 3000 ms;
- confirmacion de heartbeat inmediata con timeout 1000 ms;
- backoff offline 5, 10, 20, 30 y 60 s, con jitter +/-15%;
- suspend detiene topologia, heartbeat y probes; resume solicita health.

Blur y focus solo aportan contexto de ventana. Un cambio de fingerprint aborta
la respuesta de topologia anterior y solicita health; nunca asigna connected.
Sin direcciones externas y con `net.isOnline=false`, se aplica offline rapido.

IPC incluye `detectedAt`, `emittedAt`, `receivedAt` y `appliedAt`. Diagnostico
incluye generaciones, hash de topologia, conteos agregados de interfaces,
health iniciados/deduplicados, confirmaciones, heartbeats y transporte. No
publica IP, token, cookie ni body. `Failed to read DnsConfig` no se analiza ni
se usa como senal.
