# LOCAL-AUTO-SYNC-QUEUE-1

Sincronizacion automatica conservadora de la cola scoped pendiente.

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
- no hay otra subida automatica o manual en curso.

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
- exposicion renderer sin secretos.
