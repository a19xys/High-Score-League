# CANONICAL ACCOUNT SESSIONS 1

## Contrato

Cada `userId` tiene exactamente una sesion persistida en
`userData/accounts/sessions/<playerKey>.json`. El archivo usa el envelope de
`secure-session-storage`; su payload es una unidad indivisible con identidad,
access token, refresh token, expiracion, `sessionRevision`, `updatedAt` y
`lastWriteSource`. No se mezclan campos de respuestas distintas.

La cuenta activa es solo `lastActiveUserId` en `known-accounts.json`. Login
guarda una sesion canonica y cambia ese pointer. Switch valida la sesion destino
y cambia el pointer, sin copiar tokens. Logout o remove cancelan las operaciones
de esa cuenta, eliminan el secreto y su metadata cuando corresponde, pero no
tocan pending/sent/failed, favoritos ni preferencias scoped.

`session.json` es exclusivamente una fuente de migracion. No es leida por los
flujos de auth, membership, submission o autoenvio y se elimina solamente tras
verificar la sesion canonica. Login, refresh, switch y auth state no la recrean.

## Revision y escritura

`sessionRevision` es un entero monotono persistente por usuario. Cada login o
refresh aceptado escribe `revision + 1`; las lecturas y arranques no la cambian.
La escritura usa temporal en el mismo filesystem, `fsync`, rename, modo 0600 y
relectura de verificacion. La comparacion `expectedRevision` rechaza una
escritura stale. Si falla la escritura o verificacion, se restaura el ultimo
envelope verificado.

`known-accounts.json` tiene su propia revision monotona, escritura atomica,
cola de mutaciones en proceso y `known-accounts.lock` interproceso. Cada mutacion
adquiere el lock y relee antes de aplicar cambios; un touch tardio no crea una
cuenta ausente y un JSON corrupto no se sobrescribe.

## Coordinacion de refresh

El repositorio mantiene un single-flight por `userId`, nunca global. Ademas,
cada usuario usa `accounts/locks/session-<playerKey>.lock`, creado de forma
exclusiva con PID, nonce, fecha, proposito y hash de usuario. El lock no contiene
identidad completa, email ni tokens. Un lock solo se considera stale tras el
plazo conservador, si su PID no vive y si el nonce no ha cambiado. Timeout de
lock devuelve un resultado aplazado y conserva la sesion.

Dentro del lock se relee la sesion. Si otro proceso ya la renovo, se devuelve la
nueva revision. Si sigue expirando, se hace un solo refresh, se valida identidad,
se relee y compara la revision y se persiste. Login incrementa una generacion y
aborta el refresh anterior; su respuesta stale se descarta.

GUI y CLI usan el mismo repositorio y los mismos locks. La CLI ejecuta un bridge
minimo de Electron `safeStorage` con el mismo `userData`, por lo que puede leer y
escribir los mismos envelopes sin exponer secretos en argumentos. `auth-token`
se retiro por no tener consumidores.

## Resultados de sesion

- `valid`: la sesion existente sigue siendo utilizable.
- `refreshed`: identidad verificada y revision nueva persistida.
- `deferred`: offline, timeout, DNS, TLS, transporte, 429, 5xx, cancelacion,
  shutdown, suspend o lock temporal. Se conserva el material anterior.
- `revoked`: rechazo concluyente del refresh o identidad distinta. Se elimina
  el secreto y se conserva metadata segura con `requiresLogin`.
- `corrupt`: envelope, identidad, tokens o revision incoherentes. No se
  sobreescribe automaticamente.

Una cuenta inactiva con sesion valida puede autoenviar desde su cola scoped. Una
cuenta olvidada ya no aparece en `known-accounts.json`, pierde su sesion y no
puede ser descubierta por el autoenvio. La revocacion de A no bloquea B.

## Migracion y recuperacion

El migrador inspecciona `session.json`, las antiguas sesiones recordadas que ya
ocupaban la ruta canonica, metadata y un journal parcial. Valida candidatos por
identidad y completitud, nunca fusiona tokens y elige por sesion identica,
escritura persistida mas reciente o expiracion posterior. Una divergencia sin
criterio seguro queda `recovery-required`: conserva ambas fuentes y pide login.

El journal token-free vive en
`accounts/migration/canonical-session-v1.json`. Registra estado, hashes truncados
de fuentes, hashes de usuario, decisiones, tiempos y errores sanitizados. Los
checkpoints `sources-read`, `canonical-written`, `canonical-verified`,
`legacy-cleaned` y `completed` permiten reanudar tras una interrupcion sin
incrementar de nuevo una revision ya migrada. Solo despues de verificar se
elimina legacy; no se crean backups persistentes con tokens.

## Lifecycle, autoenvio y conectividad

Shutdown y suspend impiden nuevos refresh, abortan controladores y liberan locks
en `finally`; conservan sesion, cooldown y auth block. Remove y login incrementan
la generacion del usuario para impedir callbacks stale. Switch no cancela tareas
legitimas de otras cuentas.

El `guardKey` sigue siendo `userId + queueRevision + sessionRevision`. Una
revision canonica nueva permite reevaluar un bloqueo auth. `reachabilityGeneration`
solo forma parte de `executionIdentity`; no cambia la revision. Auth normal no
llama `resetGuards()`. La cancelacion de lifecycle usa `cancelCurrentRun()` y
preserva guards, cooldowns y bloqueos existentes. Connected sigue siendo una
decision exclusiva de health.

## Seguridad y diagnostico

Renderer, preload, IPC, known accounts, locks y journal no reciben tokens. El
diagnostico expone schema, estado de migracion, recuentos de cuentas/sesiones,
hash del activo y de operaciones en curso, contadores de lock/refresh/stale,
revision, expiracion y `requiresLogin`. No incluye email completo, payloads,
rutas fisicas de sesion ni cuerpos del proveedor. Se conserva tambien el bloque
sanitizado del coordinador de autoenvio.
