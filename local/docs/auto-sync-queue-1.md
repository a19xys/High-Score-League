# LOCAL-AUTO-SYNC-QUEUE-1

Sincronizacion automatica conservadora de la cola scoped pendiente.

## Addendum de fiabilidad prelaunch

La implementacion vigente indexa todas las cuentas recordadas con sesion
valida, no solo el pack visible. Las procesa secuencialmente mediante el
coordinador comun descrito en `submission-outcome-policy-1.md`.

HTTP 408/425/429/5xx, transporte y timeout conservan `pending` y activan
cooldown 30/60/120/300/900 s. Un 401 bloquea solo la misma revision de sesion;
la siguiente cuenta sigue teniendo oportunidad. Un cambio de cuenta visible
invalida membership interactiva, pero no cancela el lote background ya
congelado; suspend y shutdown si abortan el lote y nunca consumen la clave
terminal.

Los guards de terminalidad, cooldown y autenticacion usan una identidad estable
`userId + queueRevision + sessionRevision`. `reachabilityGeneration` identifica
la ejecucion y permite diagnosticar o rechazar trabajo stale, pero una
reconexion no crea por si sola otra oportunidad de envio. La cancelacion del
run actual esta separada del reset de guards: suspend cancela red y conserva
`retryAttempt`, `nextEligibleAt` y el bloqueo de autenticacion; resume espera un
`connected` confirmado y respeta el plazo restante. Solo el force explicito,
protegido como herramienta de desarrollo, resetea esos guards. No se persisten
entre cierres completos del proceso en este microparche.

El antiguo `submit-all` manual de GUI no tenia consumidor IPC/preload activo y
se elimino. La CLI `submit-all` permanece y comparte la clasificacion canonica.

## Objetivo

La GUI puede subir automaticamente puntuaciones pendientes cuando ya sabe que
la cuenta activa participa en la temporada del pack activo.

No sustituye la cola local. La cola sigue siendo la fuente segura si no hay
sesion, no hay membership verificada, hay errores de red o la subida falla.

## Alcance

- Solo aplica a la GUI.
- Solo usa la cola scoped de cuenta activa y pack activo en `userData`.
- Reutiliza el flujo existente de `submitAll(scoped.config)`.
- No cambia payloads, `duplicateKey`, ingest, plugin MAME ni estructura de
  scoped queue.
- `LOCAL-PACK-CONTRACT-2` no cambia estas reglas: v1 y v2 sincronizan solo
  desde la cola scoped del pack activo cuando membership permite subir.
- No anade polling permanente ni sincronizacion en segundo plano.
- No cambia `config.json`.

## Elegibilidad

La subida automatica solo se intenta si todas estas condiciones son ciertas:

- hay sesion local activa;
- la comprobacion de temporada devuelve `membership.status === "member"`;
- `membership.canSubmit === true`;
- existe scope de cuenta y pack;
- la cola scoped tiene `pending > 0`;
- no hay otra subida automatica en curso.

Estados que bloquean auto-sync:

```text
not_member
no_session
unauthenticated
missing_week
invalid_week
error
unknown
```

`error` y `unknown` pueden permitir jugar competicion con aviso, pero no
permiten subir automaticamente. La puntuacion queda guardada localmente hasta
que se pueda comprobar la temporada.

## Disparadores

La GUI intenta sincronizar de forma oportunista al refrescar el estado principal
y despues de acciones que pueden hacer viable una subida:

- abrir la GUI y pedir estado;
- iniciar sesion correctamente;
- abrir o activar un pack;
- comprobar de nuevo la temporada;
- terminar una partida de competicion;
- restaurar una puntuacion desde `failed` a `pending`.

No se dispara desde diagnostico, practica, `sync-plugin`, cerrar sesion,
quitar una cuenta recordada, anadir/quitar ubicaciones de biblioteca ni al
abrir enlaces web.

Con `LOCAL-ACCOUNT-SWITCHER-GUI-2`, cambiar cuenta puede activar una sesion
local recordada sin pedir contrasena. Tras el cambio, el estado completo se
recalcula y auto-sync puede actuar si la nueva cuenta es `member`, hay scope y
existen pendientes.

## Estado visible

El panel del juego muestra un estado secundario de auto-sync junto al estado de
temporada. Los estados principales son:

```text
idle
blocked
not_eligible
syncing
synced
partial_failed
failed
```

Durante `syncing`, el boton manual `Subir pendientes` queda bloqueado para
evitar subidas dobles. La accion manual sigue disponible cuando no hay auto-sync
en curso y conserva sus propios bloqueos de sesion y membership.

Los detalles tecnicos muestran estado, motivo, ultimo intento, ultimo exito y
contadores `pending` antes/despues. No muestran tokens, password, cabeceras de
autorizacion ni `session.json`.

Cada contexto obtiene su sesion exclusivamente del repositorio canonico. Una
cuenta inactiva valida conserva autoenvio; una cuenta eliminada desaparece del
indice y no resucita por un touch tardio. Un refresh aceptado incrementa
`sessionRevision` y forma el nuevo guardKey natural, sin `resetGuards()` ni
cambios en cooldown o autoridad de conectividad.

`LOCAL-PACK-READINESS-1` consume este estado para resumir si el pack esta listo
para practicar, competir y sincronizar. Ese resumen no cambia la elegibilidad
ni dispara subidas nuevas; solo presenta la misma informacion en una capa mas
comprensible para el jugador.

## Fallos

Si la subida automatica falla, las puntuaciones siguen en la cola local o pasan
a `failed` segun el comportamiento existente de `submitAll`. La GUI muestra un
estado de fallo o atencion, y el jugador puede usar la recuperacion manual ya
existente.

No hay reintentos infinitos ni bucles permanentes. El siguiente intento llega
con otro disparador normal de la GUI.

## Pruebas

Las pruebas cubren:

- elegibilidad member/session/scope/pending;
- bloqueo de `not_member`, `no_session`, `unauthenticated`, `missing_week`,
  `invalid_week`, `error` y `unknown`;
- lock de intentos concurrentes;
- resumen de `synced`, `partial_failed` y `failed`;
- cooldown, auth block y terminalidad estables tras reconexion o suspend/resume;
- cancelacion de ejecucion separada del reset explicito de guards;
- exposicion renderer sin secretos.

## Presentación actual

Auto-sync se muestra dentro de `Actividad local` como estado, no como flujo
técnico principal. `Subir pendientes` sigue disponible para recuperación y los
detalles permanecen limitados al scope activo.
