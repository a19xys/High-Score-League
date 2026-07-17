# CANONICAL ACCOUNT SESSIONS STABILIZATION 2

## Estado y alcance

Este documento describe la estabilización implementada sobre el repositorio
canónico de sesiones por cuenta. Es la referencia de detalle para resultados,
vigencia remota, revisiones, locks, migración y cierre. Complementa
[canonical-account-sessions-1.md](canonical-account-sessions-1.md) y prevalece
cuando aquel documento use una descripción anterior o más general.

La cobertura automática existente valida contratos y fallos inyectados. No
equivale a validar una aplicación empaquetada contra Supabase staging ni a
probar durabilidad ante pérdida física de energía. El protocolo de staging al
final de este documento está **pendiente y no se ejecutó** durante esta
estabilización.

## Arquitectura y autoridades

La identidad estable es `userId`; `playerKey` solo deriva nombres de archivo y
scopes. Cada dato tiene una autoridad distinta:

| Dato | Ruta bajo `userData` | Autoridad y contenido |
| --- | --- | --- |
| Sesión canónica | `accounts/sessions/<playerKey>.json` | Envelope v2 y payload completo de una sola sesión: identidad, tokens, expiración, origen del proveedor y revisión. |
| Ledger de revisión | `accounts/session-revisions/<playerKey>.json` | Última revisión reservada/confirmada y disposición `session` o `tombstone`. Sobrevive a la eliminación del secreto. |
| Cuentas conocidas | `accounts/known-accounts.json` | Presentación segura, `lastActiveUserId`, `requiresLogin` y última revisión observada; no contiene tokens. |
| Journal de migración | `accounts/migration/canonical-session-v1.json` | Checkpoints, hashes truncados y decisiones sin tokens. |
| Lock por cuenta | `accounts/locks/session-<playerKey>.lock` | Serializa login, refresh, revoke, remove y migración de ese usuario entre procesos. |
| Lock de metadata | `accounts/locks/known-accounts.lock` | Serializa mutaciones de cuentas conocidas. |
| Lock de migración | `accounts/locks/canonical-migration.lock` | Impide dos migraciones globales simultáneas. |
| Fuente legacy | `session.json` configurado | Solo entrada del migrador; no es autoridad de runtime y se elimina después de completar los checkpoints verificables. |

`lastActiveUserId` es un puntero, no otra sesión. Cambiar de cuenta no copia
tokens. GUI y CLI deben resolver la misma sesión canónica y respetar los mismos
locks; el lock de instancia única de Electron no coordina una CLI separada.

## Contrato canónico de resultado

Todo resultado creado por `createSessionResult` expone los mismos campos:
`status`, `ok`, `hasLocalSession`, `remoteUsable`, `shouldRetry`,
`requiresLogin`, `terminal`, `sessionRevision`, `storedSession`, `reason`,
`error`, `stale`, `migrationRequired`, `lockState` y `retryAfterMs`.
`reason`, errores y estado del lock se acotan y sanitizan.

La matriz normativa es:

| `status` | `ok` | Local | Red | Reintentar | Login | Terminal | Interpretación |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `valid` | sí | sí | sí | no | no | sí | Sesión vigente y apta para una llamada remota. |
| `refreshed` | sí | sí | sí | no | no | sí | Refresh validado y nueva revisión persistida. |
| `deferred` | no | normalmente sí | solo si se declara y el token aún supera el margen absoluto | sí | no | no | Trabajo remoto aplazado; conservar estado local. |
| `revoked` | no | no | no | no | sí | sí | Rechazo concluyente o identidad incompatible; se usa tombstone. |
| `corrupt` | no | sí, pero no confiable | no | no | sí | sí | Material local incoherente; no usarlo en red. |
| `missing` | no | no | no | no | sí | sí | No existe secreto utilizable. |
| `recovery-required` | no | sí | no | no | sí | sí | Fuentes/ledger requieren recuperación; `migrationRequired=true`. |
| `cancelled` | no | depende de la operación | no | sí | no | no | Cancelación de lifecycle u operación; no es logout. |
| `stale` | no | depende de la operación | no | sí | no | no | Respuesta superada por una generación o revisión posterior; `stale=true`. |
| `lock-timeout` | no | depende de la lectura actual | no | sí | no | no | No se obtuvo el lock dentro del plazo; conservar y reintentar. |
| `provider-mismatch` | no | sí | no | no | sí | sí | La sesión pertenece a otro origen configurado. |
| `storage-unavailable` | no | sí | no | sí | no | no | El envelope existe, pero su proveedor de protección no está disponible. |

Reglas para consumidores:

- `hasLocalSession` solo indica conservación local. Nunca autoriza red.
- Solo `remoteUsable === true` y `requiresLogin === false` autoriza membership,
  ingest u otra llamada autenticada.
- `requiresLogin === true` se traduce a `auth-required`; no se reintenta como
  fallo de transporte.
- Un resultado no terminal con `shouldRetry === true` se traduce a
  `auth-deferred`. No consume ni mueve los `pending` por sí mismo.
- `deferred` puede conservar un access token todavía utilizable mientras el
  refresh está aplazado. Los demás estados no pueden elevar
  `remoteUsable` mediante datos suministrados por el llamador.

## Vigencia remota y binding del proveedor

Los umbrales por defecto son 60 segundos para recomendar refresh y 5 segundos
como margen absoluto mínimo de uso. Pueden inyectarse valores distintos al
construir el repositorio, pero el orden se mantiene: el umbral de refresh nunca
queda por debajo del margen absoluto.

| Tiempo restante por defecto | Resultado de política |
| --- | --- |
| `<= 0 s` | `token-expired`; no apto para red. |
| `> 0 s` y `<= 5 s` | `token-lifetime-insufficient`; no apto para red. |
| `> 5 s` y `<= 60 s` | `refresh-recommended`; aún apto para red mientras se intenta renovar. |
| `> 60 s` | `token-usable`; apto para red. |

Ausencia o formato inválido de `expires_at`, access token, identidad, JWT o
binding impide `remoteUsable`. Si hay refresh token, una expiración ausente o
dentro del umbral solicita refresh, pero no convierte por sí sola el access
token en utilizable.

El proveedor se vincula al origen normalizado exacto `scheme://host:port`. No
se admiten credenciales, query, fragmento ni path distinto de `/` en la URL que
forma la identidad. El payload guarda el origen y un fingerprint SHA-256
truncado; ambos se contrastan con `config.supabaseUrl`. Cambio de protocolo,
host, puerto, proyecto o fingerprint produce `provider-mismatch` y exige login
para el proveedor configurado. El campo `provider` del envelope identifica el
backend de cifrado local y no sustituye este binding remoto.

## Refresh, single-flight y backoff

El single-flight se aplica por `userId` y por identidad de política
(`connected`, `deferRemote`, `force`, generación y revisión base). El lock por
usuario extiende la exclusión a otros procesos. Ya dentro del lock se releen
sesión y revisión; una respuesta que pierda contra login, remove, revoke u otra
generación termina `stale` y no se persiste.

Los fallos temporales de refresh (429, 5xx, timeout o error marcado
reintentable) conservan la sesión y aplican, por usuario, la secuencia por
defecto `30/60/120/300/900 s`. Un `Retry-After` válido puede ampliar el plazo,
acotado a 15 minutos por defecto. Login o refresh correcto reinicia el estado.
El backoff vive en memoria: se comparte dentro del repositorio actual, pero se
reinicia al cerrar el proceso. Esto es una limitación deliberada, no una
garantía persistente contra tormentas entre reinicios.

Solo un rechazo clasificado expresamente como revocación o una identidad
incompatible crea tombstone. DNS, TLS, transporte, timeout, 429 y 5xx no borran
el secreto ni se presentan como logout.

## Ledger de revisiones y tombstones

La revisión no depende de que el envelope actual siga existiendo. Antes de una
escritura, `reserveSessionRevision` toma el máximo observado entre ledger,
envelope y metadata, suma uno y escribe un registro `committed:false`. Después
de escribir y verificar el envelope, `commitSessionRevision` confirma esa
revisión. Un login posterior a revoke, remove o borrado manual observa el
ledger y debe usar una revisión mayor.

Orden de persistencia de login, refresh o migración de una sesión:

1. preflight de `known-accounts.json` sin modificarlo;
2. reserva `session` en el ledger;
3. escritura CAS y verificación del envelope;
4. confirmación `session` en el ledger;
5. actualización de la metadata conocida.

Orden de revoke o remove:

1. preflight de metadata y lectura del envelope;
2. reserva de una revisión `tombstone` superior;
3. eliminación del secreto canónico;
4. confirmación del tombstone;
5. marca `requiresLogin`, conservación de metadata o eliminación de la cuenta,
   según la operación solicitada.

Una lectura en la que el tombstone supera al envelope trata la sesión como
ausente/revocada aunque haya quedado un archivo viejo. Esto impide que una
copia anterior resucite por comparación de timestamps. El ledger no contiene
tokens ni reemplaza la validación de identidad del envelope.

## Atomicidad por archivo y orden multiarchivo

`atomicWriteJson` crea un temporal exclusivo en el mismo directorio, escribe,
hace `fsync` del archivo, cierra y renombra. El envelope se relee y descifra
para verificar identidad y revisión; un fallo intenta restaurar el valor
anterior. Estas propiedades son por archivo.

No existe una transacción atómica de filesystem que abarque envelope, ledger,
metadata y journal. La consistencia multiarchivo depende de preflight, orden,
revisiones, tombstones, checkpoints y reintento. Tampoco se hace `fsync` del
directorio después del rename, por lo que no se promete durabilidad absoluta
ante pérdida de energía en todas las plataformas.

Orden global de adquisición que debe conservar cualquier extensión:

1. `canonical-migration.lock`, solo para migración o su recuperación;
2. `session-<playerKey>.lock` para un usuario;
3. `known-accounts.lock` cuando se actualiza metadata.

Las reservas y confirmaciones del ledger se ejecutan dentro del lock de usuario
en el repositorio. El módulo de ledger no adquiere ese lock por sí mismo y no
debe invocarse fuera de esa disciplina. Una mutación que solo cambia la cuenta
activa toma únicamente `known-accounts.lock`; ningún flujo debe tomar después
un lock de usuario mientras conserva el de metadata.

Posibles cortes y comportamiento esperado:

- corte tras reservar y antes de escribir: queda una revisión no confirmada;
  la siguiente mutación avanza desde ella y no la reutiliza;
- corte tras escribir envelope y antes de actualizar metadata: envelope y/o
  ledger conservan la revisión superior, pero la presentación puede requerir
  relogin o reparación posterior;
- corte tras reservar tombstone: la revisión superior invalida cualquier
  envelope anterior incluso si la limpieza no terminó;
- `known-accounts.json` corrupto detiene la mutación antes de tocar la sesión;
  no se sobrescribe automáticamente.

## Migración y recuperación

La migración completa está protegida por `canonical-migration.lock` y, dentro
de él, procesa cada usuario bajo su lock. El journal avanza por
`sources-read`, `canonical-written`, `canonical-verified`, `legacy-cleaned` y
`completed`. Solo el camino sin ambigüedad elimina la fuente legacy.

Los candidatos nunca se fusionan campo a campo. Se acepta una única fuente
válida; dos fuentes con los mismos tokens se resuelven por revisión; si son
distintas, se usa escritura persistida más reciente o expiración posterior.
Una divergencia que sigue empatada, identidad incompatible, proveedor distinto
o journal ilegible produce `recovery-required` y conserva las fuentes.

Recuperación soportada:

- un login válido del usuario no resuelto escribe una revisión nueva bajo su
  lock y después completa la recuperación bajo el lock global;
- un journal corrupto puede regenerarse durante esa recuperación explícita;
- si falta el backend de almacenamiento que exige un envelope cifrado se
  produce `storage-unavailable`: se debe restaurar el mismo proveedor de
  protección y reintentar, sin borrar el envelope;
- un envelope corrupto no se usa en red; un login explícito puede reemplazarlo
  con identidad verificada y revisión superior;
- un ledger corrupto produce `recovery-required`. El código actual no demuestra
  una reparación automática general de ese ledger: se deben conservar los
  archivos y usar un flujo de soporte/relogin validado antes de eliminar nada;
- metadata corrupta bloquea escrituras de sesión y requiere reparación de
  soporte; el sistema evita sobrescribirla silenciosamente.

## Política de locks truncados o stale

La adquisición usa creación exclusiva. El archivo registra PID, nonce,
timestamp, propósito y hash de usuario, sin email ni tokens. La espera acepta
`AbortSignal`; aborto devuelve `SESSION_LOCK_ABORTED` y timeout
`SESSION_LOCK_TIMEOUT`.

Un PID que `process.kill(pid, 0)` considera vivo —incluido `EPERM`— nunca se
elimina. Para un PID muerto o contenido vacío, truncado o malformado, el lock
debe superar el periodo de gracia (1 segundo por defecto, configurable). Se
hacen dos lecturas de contenido y metadatos y solo se recupera si son estables.
Después se renombra a cuarentena, se vuelve a verificar identidad/contenido y
se elimina; si apareció otro propietario, se intenta restaurar sin
sobrescribirlo. Release compara nonce e identidad del archivo, es idempotente y
propaga errores reales de limpieza.

Esta política reduce carreras, pero la detección basada en PID no incorpora el
tiempo de arranque del proceso. La reutilización rápida de un PID puede causar
espera conservadora hasta timeout; no se afirma protección perfecta frente a
PID reuse ni a semánticas anómalas de un filesystem de red.

## Shutdown y drain

`shutdown()` es idempotente: marca el repositorio como cerrándose, incrementa
generaciones, aborta controladores y devuelve la misma promesa de drain. Las
nuevas operaciones de refresh/remove/revoke responden canceladas; login y
set-active rechazan nuevas escrituras según su contrato.

El drain toma una instantánea de operaciones activas y espera su finalización o
un timeout de 3 segundos por defecto. Devuelve `drained`, `timedOut`,
`pendingOperations` y `reason`. Los locks se liberan en los `finally` de cada
operación; un timeout no borra a la fuerza un lock ni mata el proceso. Por
tanto, `timedOut:true` significa que el llamador debe registrar el residual y
permitir que la operación termine si el proceso sigue vivo. La integración de
cada cierre de plataforma debe esperar esta promesa; la existencia de la API no
demuestra por sí sola que un cierre forzado del sistema operativo conceda ese
tiempo.

## Evidencia automática disponible

La suite incluye pruebas del contrato de resultados, umbrales y binding,
backoff, refresh HTTP, locks truncados/carreras, migración serializada,
revisiones/tombstones, shutdown y consumo de auth por membership/submission.
Entre otras, las referencias directas son:

- [`session-result.test.js`](../hsl-local-app/test/session-result.test.js)
- [`session-refresh-policy.test.js`](../hsl-local-app/test/session-refresh-policy.test.js)
- [`session-refresh-http.test.js`](../hsl-local-app/test/session-refresh-http.test.js)
- [`file-lock.test.js`](../hsl-local-app/test/file-lock.test.js)
- [`session-stabilization.test.js`](../hsl-local-app/test/session-stabilization.test.js)
- [`submission-auth-integration.test.js`](../hsl-local-app/test/submission-auth-integration.test.js)

Estas pruebas no verifican el panel de Supabase, el keyring real de cada
distribución Linux, suspend físico, pérdida de energía ni el ejecutable
empaquetado.

## Riesgos residuales

- El ciclo real contra un proyecto Supabase staging no se ejecutó.
- La política remota de time-boxing, inactivity, single-session y rotation debe
  comprobarse manualmente en el proyecto usado para release.
- No hay atomicidad total multiarchivo ni `fsync` de directorio; la recuperación
  depende del orden y del ledger/journal.
- PID reuse, filesystems no locales y cierres abruptos siguen siendo riesgos de
  plataforma.
- El backoff de refresh se reinicia con el proceso.
- `safeStorage` degradado reduce confidencialidad; si falta el backend requerido
  por un envelope existente, el material queda ilegible hasta restaurarlo.
  Permisos `0600` no equivalen a cifrado.
- CLI con bridge Electron, suspend/reanudación, cierre bajo proveedor colgado y
  rotación real deben verificarse en binarios empaquetados por sistema operativo.
- Un ledger o `known-accounts.json` corrupto conserva datos y bloquea mutaciones,
  pero todavía requiere un procedimiento de soporte validado.

## Protocolo exacto de staging — pendiente, no ejecutado

Preparación: usar un proyecto Supabase no productivo, una cuenta desechable y
un perfil `userData` aislado. Habilitar observabilidad que registre revisiones,
resultado y llamadas, nunca tokens, Authorization ni payloads privados. Anotar
versión/commit, SO, backend `safeStorage`, configuración Auth y hora de cada
paso. Conservar los `pending` de prueba hasta finalizar.

1. Iniciar sesión con la cuenta desechable en el proyecto no productivo.
2. Cerrar la aplicación de forma normal y volver a abrirla.
3. Esperar una expiración corta o forzarla con configuración exclusiva de staging.
4. Provocar una operación remota y confirmar que ocurre un refresh real.
5. Confirmar la rotación mediante telemetría del proveedor o fingerprints efímeros unidireccionales generados por el harness; no copiar tokens al informe.
6. Cerrar y volver a abrir la aplicación después de la rotación.
7. Confirmar que la siguiente operación usa la sesión rotada y no una fuente legacy.
8. Arrancar dos consumidores autorizados sobre el mismo `userData` (por ejemplo GUI y CLI).
9. Provocar expiración y confirmar una sola llamada de refresh y una sola revisión ganadora.
10. Retirar la red antes/durante un refresh con puntuaciones `pending` existentes.
11. Restaurar la red y esperar health confirmado antes del nuevo intento.
12. Confirmar que el fallo temporal no produjo falso logout ni borró sesión/metadata.
13. Revocar el refresh token o la sesión desde el servidor de staging.
14. Provocar refresh y confirmar `requiresLogin:true`, `remoteUsable:false` y tombstone superior.
15. Iniciar sesión de nuevo con la misma cuenta.
16. Confirmar que la revisión de relogin es mayor que todas las revisiones y tombstones anteriores.
17. Confirmar que los `pending` originales siguen intactos o se enviaron una sola vez tras auth válida, nunca se descartaron por el ciclo de sesión.

Evidencia de aprobación: tabla por paso con hora, resultado canónico, revisión,
conteo de refresh/ingest, estado de pending y capturas/logs sanitizados. Si un
paso falla, preservar el perfil aislado y registrar el riesgo; no repetir
borrando archivos hasta entender la secuencia. Hasta completar los 17 pasos,
la estabilización debe describirse como cubierta por código y pruebas
automáticas, no como validada end-to-end en staging.
