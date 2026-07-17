# CONNECTIVITY STATE 1

Main es la autoridad de reachability. `net.isOnline`, eventos renderer y
`os.networkInterfaces()` son indicios; solo el health 204 del origen HSL
confirma `connected`. HTTP alcanzable con error de producto, incluido 503,
confirma reachability sin convertir el producto en disponible.

`Conectado` significa exclusivamente que el launcher alcanza el health fiable
del origen HSL global configurado. No describe biblioteca, pack, sesion,
membership, Ranking ni posibilidad de enviar una puntuacion. El origen procede
de `config.webBaseUrl`; un pack nunca puede sustituirlo.

El selector canonico deriva disponibilidad solo de `reachability` comprometido.
El header oculta `unknown`. Un probe manual o retry conserva la etiqueta y la
compuerta anterior; solo deshabilita temporalmente refresh. El selector acepta
`null`, `undefined`, objeto vacio y estados parciales. Ranking y las restantes
acciones remotas usan el mismo selector, no `displayStatus` ni `probe.phase`.

Politica desde RECOVERY-5:

- topologia local cada 1000 ms, sin trafico de red;
- heartbeat conectado cada 20 s, enfocada, desenfocada o minimizada;
- health timeout 3000 ms;
- confirmacion de heartbeat inmediata con timeout 1000 ms;
- durante el primer minuto offline, recovery canary cada 3 s;
- entre 1 y 5 minutos offline, recovery canary cada 5 s;
- despues de 5 minutos, intervalos 10, 20, 30 y 60 s;
- el canary usa timeout de 1000 ms y no muestra overlay;
- suspend detiene topologia, heartbeat y probes; resume solicita health.

Un scheduler unico gobierna heartbeat, canary, eventos de topologia, online,
resume y refresh manual. Solo existe un timer futuro y un health en vuelo. Las
senales simultaneas se deduplican y las generaciones stale no pueden confirmar
estado. Foco, blur y minimizado no alteran esta politica.

Blur y focus solo aportan contexto de ventana. Un cambio de fingerprint aborta
la respuesta de topologia anterior y solicita health; nunca asigna connected.
Sin direcciones externas y con `net.isOnline=false`, se aplica offline rapido.

IPC incluye `detectedAt`, `emittedAt`, `receivedAt` y `appliedAt`. Diagnostico
incluye generaciones, hash de topologia, conteos agregados de interfaces,
health iniciados/deduplicados, confirmaciones, heartbeats y transporte. No
publica IP, token, cookie ni body. `Failed to read DnsConfig` no se analiza ni
se usa como senal.

Las peticiones de producto (membership, Ranking e ingest) no llaman a
`markReachable` ni `signalOffline`. Ante transporte pueden solicitar un health
inmediato; el resultado del health sigue siendo la unica autoridad que
compromete reachability. Suspend y shutdown abortan las peticiones de producto,
y resume crea un contexto nuevo.

El renderer rechaza generaciones antiguas y aplica cada snapshot de
conectividad en una unica escritura del store. Chip, Ranking y futuros controles
remotos se derivan durante el mismo render.
