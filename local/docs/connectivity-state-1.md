# CONNECTIVITY STATE 1

Main es la autoridad de reachability con un contrato asimetrico. Solo un health
204 valido del origen HSL confirma `connected`. `offline` puede comprometerse
por un fallo autoritativo de ese health o por una senal negativa fuerte cuya
frontera vuelve a comprobar `net.isOnline() === false`. Una respuesta de
producto, incluso HTTP alcanzable, nunca compromete reachability.

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
Sin direcciones externas y con `net.isOnline() === false` comprobado en main,
se aplica offline rapido. Si main sigue viendo online, la topologia solo pide
health y no cambia el chip.

IPC incluye `detectedAt`, `emittedAt`, `receivedAt` y `appliedAt`. Diagnostico
incluye generaciones, hash de topologia, conteos agregados de interfaces,
health iniciados/deduplicados, confirmaciones, heartbeats y transporte. El
objeto `authority` declara `health-204`,
`health-or-main-system-offline` y `hints-only` para renderer y producto. No
publica IP, token, cookie ni body. `Failed to read DnsConfig` no se analiza ni
se usa como senal.

Las peticiones de producto (membership, Ranking e ingest) y los eventos
renderer son indicios. No existe `markReachable` publico ni un setter offline
que acepte ciegamente la afirmacion del caller. Ante transporte o senales
renderer pueden solicitar un health inmediato; renderer-offline solo usa el
fast path cuando main verifica `net.isOnline() === false`. Renderer-online y
connection-change solo aceleran recovery. Suspend y shutdown abortan las
peticiones de producto, y resume crea un contexto nuevo.

El renderer rechaza generaciones antiguas y aplica cada snapshot de
conectividad en una unica escritura del store. Chip, Ranking y futuros controles
remotos se derivan durante el mismo render.
