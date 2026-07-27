# LOCAL PRE-BETA CONNECTIVITY MEMBERSHIP STARTUP 4V.1B

## 1. Objetivo

4V.1B corrige dos regresiones de conectividad y cierra el tramo de
orquestación que faltaba en membership al arrancar. El resultado contractual
es:

- ningún estado de conexión visible antes del primer compromiso;
- indicador binario posterior mediante punto CSS y texto;
- botón manual `Comprobar conexión` separado, accesible y con feedback común;
- probes automáticos silenciosos;
- una única resolución inicial de membership, identificada, acotada y
  cancelable;
- `Comprobando participación` solo mientras esa resolución existe;
- `Jugar` bloqueado en frontend y backend durante checking;
- `member` más pack local preparado termina en `Pack listo`.

No se crean otra autoridad de conectividad, otro store, otro overlay, polling
ni un monitor remoto adicional.

## 2. Base

La base es `cea9a05b8b0864abdd99102c091ecf3daa80373b`, mensaje
`Estabilizar cuenta, participación y conectividad v1`, en `master`. Incluye 4V.1
y 4V.1A. El árbol estaba limpio al comenzar 4V.1B y no se creó commit.

Se preservan las autoridades de 3A–3B.3: `launcherStateRevision`, publicación
monotónica en `main`, rechazo stale, montaje único, renderer regional, readiness
de startup, tema, assets generacionales, primitivas semánticas y región live
focalizada. También se preservan sesiones canónicas, colas scoped, autoenvío,
Ranking capability y la seguridad del preload.

## 3. Diagnóstico del startup

El orden real anterior era el siguiente:

1. `app.whenReady()` resolvía el tema canónico e inicializaba almacenamiento y
   servicios remotos.
2. `connectivity.start("startup")` comenzaba, sin await, antes de crear
   `BrowserWindow`; su primer evento `connecting` no tenía aún ventana destino.
3. Se creaba la ventana oculta, se cargaba `index.html` y se mostraba en
   `ready-to-show`.
4. `theme-bootstrap.js` aplicaba el tema entregado por `main` antes del módulo
   principal.
5. El renderer nacía con `connectivity:null`, `data:null` y startup visible;
   montaba una vez shell, header y overlay `Iniciando...`.
6. Después registraba listeners y solicitaba en paralelo conectividad, Ranking
   y estado local inicial.
7. `launcher:get-initial-state` esperaba solo la migración local de sesiones.
8. `getLauncherContext()` leía sesión/cuenta activa, escaneaba la biblioteca,
   reconciliaba la selección recordada y materializaba el pack real.
9. El estado inicial llamaba membership con `deferRemoteMembership:true`.
10. `stateFromContext()` evaluaba cola y readiness local y construía el primer
    snapshot monotónico.
11. El renderer aceptaba el snapshot, derivaba badge y acciones, resolvía los
    assets críticos y retiraba startup según sus fases y deadline propios.
12. Conectividad y membership no formaban parte de `REQUIRED_PHASES`.
13. El health probe comprometía después `connected` u `offline` y emitía el
    evento autoritativo.
14. El listener de conectividad solo actualizaba Ranking y autoenvío; no
    recomprobaba membership.
15. La activación posterior de un pack sí ejecutaba incidentalmente un
    `getState()` no diferido, que por fin hacía la consulta remota.

Así, el arranque podía retirar su overlay antes del health y podía conservar
membership diferida indefinidamente aunque pack, cuenta, sesión y red fueran
válidos.

## 4. Causa del destello de `Desconectado`

El falso negativo no lo introducía un snapshot remoto. Lo producía el primer
render local: `renderConnectionControl()` recibía `connectivity:null` y
`derivePublicConnectivityPresentation()` convertía cualquier valor distinto de
`connected` en `disconnected`. El texto, punto rojo y semántica aparecían en el
DOM antes de registrar el listener.

La consulta `getConnectivityState()` podía reforzar el mismo resultado mientras
el probe seguía con `reachability:unknown`. Solo el posterior evento health 204
cambiaba el chip a `Conectado`. La solución no retrasa startup: corrige la
presentación previa al compromiso.

## 5. Presentación antes del primer compromiso

La proyección pública conserva únicamente `connected` y `disconnected`, pero
expone además el metadato `committed`. El header solo materializa el contenido
binario cuando ese metadato es verdadero.

| Estado técnico | Comprometido | Contenido del chip | Acción refresh | Live |
| --- | --- | --- | --- | --- |
| `unknown` inicial | no | vacío, oculto y `aria-hidden` | oculta, disabled y fuera del tab order | no |
| probe inicial activo | no | igual; sin texto, punto ni spinner | igual | no |
| `connected` | sí | `Conectado`, punto verde | visible si es aplicable | cambio binario real |
| `offline` | sí | `Desconectado`, punto rojo | visible si es aplicable | cambio binario real |
| probe automático desde connected | sí | conserva `Conectado` | protegida según operación | no por el probe |
| retry desde offline | sí | conserva `Desconectado` | protegida según operación | no por el probe |
| suspendido tras un binario | sí | conserva el último binario | disabled | no |
| timeout/error del probe inicial | sí, al asentarse offline | `Desconectado`, punto rojo | visible | resultado binario |
| configuración `missing`/`invalid` | sí, terminal local | `Desconectado`, punto rojo | disabled por configuración | solo transición real |
| refresh manual activo | conserva el anterior | no introduce tercer texto | disabled y `aria-busy` | no duplica el overlay |

El contenedor completo reserva 164 px; dentro, el chip conserva sus 118 px y el
botón su ancho fijo. `visibility:hidden` y markup vacío evitan layout shift sin
crear `Desconocido`, `Comprobando conexión` o `Reconectando` como tercer estado.

## 6. Restauración del refresh manual

El header vuelve a incluir un `<button type="button">` independiente con
`data-action="refresh-connectivity"`. Usa el SVG local `refresh`, permitido
porque representa una acción y no el estado. El indicador sigue siendo
exclusivamente punto CSS y texto binario; no reaparecen check/cross SVG.

La disponibilidad deriva del modelo común de acciones. El botón no se ofrece
antes del primer compromiso, durante suspend, con configuración remota inválida
o ausente, durante otra operación busy ni mientras ya existe un probe manual.
El listener delegado existente atiende ratón y teclado sin añadir listeners por
render.

## 7. Probes automáticos y acción explícita

Startup, heartbeat, retry, resume, foco, topología y señales del renderer
continúan llamando directamente a la autoridad de conectividad y nunca tocan
`busy` ni el runner de feedback. Son silenciosos y preservan el último binario.

Solo el click explícito recorre:

```text
botón -> runAction -> runWithOperationFeedback
      -> launcher:request-connectivity-refresh("manual")
      -> connectivity.refresh(... phase:"manual")
      -> evento launcher:connectivity-state
      -> applyConnectivityState -> chip autoritativo
```

El objeto retornado por IPC sirve para resumir la acción; no escribe el chip ni
se convierte en una autoridad alternativa.

## 8. Lifecycle del overlay

`runAction()` comprueba `busy` antes de aceptar la intención, incrementa
`busyRunSequence`, fija inmediatamente `busy:true` y
`busyLabel:"Comprobando conexión"`, y reutiliza el overlay común. La copy es
`Comprobando conexión...` y el texto secundario
`Verificando la conexión con High Score League.`.

`runWithOperationFeedback()` aplica el mínimo visible compartido y devuelve el
resultado o error al mismo run. Solo el `runId` vigente puede limpiar busy,
añadir el resultado al log o cerrar el overlay. El segundo click queda
rechazado por busy y el botón nativo está disabled. Éxito y error limpian el
estado. En `beforeunload` se invalida el run y se cancela cualquier timer de
fase compartido, evitando cierres tardíos u overlays huérfanos.

## 9. Flujo inicial de membership

El primer snapshot local sigue siendo deliberadamente rápido y solicita
membership diferida. `syncRemoteContext()` entrega ese snapshot al coordinador
de startup situado en `main`. El coordinador:

1. obtiene cuenta activa, instancia, `weekId` y revisión de sesión;
2. descarta contextos imposibles —sin cuenta, sesión, semana, pack o
   configuración remota utilizable—;
3. si el health inicial está activo, crea un pipeline real en etapa
   `waiting-connectivity`;
4. si conectividad ya está comprometida como connected, agenda la petición en
   microtask;
5. publica un snapshot checking mediante `launcherStateAuthority`;
6. ejecuta `getLauncherState({ connected:true, signal })`, que puede resolver o
   refrescar la sesión canónica y consultar membership;
7. publica el resultado terminal con una revisión posterior.

No depende de cambiar de pack, abrir Ranking, abrir Avanzado ni observar una
etiqueta en el renderer.

## 10. Causa exacta de la no convergencia

Antes de 4V.1B, `launcher:get-initial-state` pedía
`deferRemoteMembership:true`. `checkSeasonMembership()` devolvía
`status:"unknown"`, `technicalReason:"deferred"`, `checkedAt:null` y
`canPlayCompetition:true`, sin request. 4V.1A dejó de presentarlo falsamente
como checking, pero no añadió ningún trigger posterior.

El listener de `connected` solo refrescaba capacidades de Ranking y programaba
autoenvío. Incluso el snapshot publicado después de autoenvío volvía a pedir
membership diferida. La única ruta no diferida era incidental a ciertas
acciones. El tramo ausente era, por tanto, la coordinación entre snapshot local
estable y conectividad comprometida; no un problema de copy ni de timeout.

## 11. Trigger y coordinador aplicado

`createMembershipStartupCoordinator()` es un coordinador acotado de proceso,
no un store de producto. Recibe snapshots canónicos, observa eventos de la
autoridad de conectividad y publica exclusivamente a través de
`launcherStateAuthority` y el canal `launcher:state` ya existentes.

Se activa al observar el primer membership diferido con prerrequisitos útiles y
un probe inicial real, o cuando una generación conectada converge después. Un
estado offline asienta el pipeline sin petición imposible. Una generación
conectada posterior permite un nuevo intento. El `get-state` genérico permanece
diferido para que las interacciones incidentales no creen una segunda política
de resolución.

## 12. Identidad y deduplicación

El contexto lógico se compone de cuenta activa, instancia de pack y `weekId`.
La revisión de sesión se transporta en el contexto; una sesión refrescable
continúa dentro del mismo pipeline. La identidad de ejecución añade la
`reachabilityGeneration` comprometida. Cada operación tiene además una
generación propia y revisiones reservadas para checking y resultado.

Solo puede existir un pipeline activo. Snapshots equivalentes actualizan su
base pero no crean otra consulta. Las identidades intentadas se guardan en un
set acotado a 64 entradas. Los resultados terminales se guardan en un mapa LRU
de hasta 64 contextos para que A -> B -> A recupere el resultado estable sin
otra consulta; ninguna de las dos estructuras se persiste. Reautenticación y
mutaciones de pack invalidan el terminal relacionado, mientras que un cambio
normal de cuenta puede reutilizarlo. Una nueva generación conectada puede
reintentar un resultado retryable; dos cuentas, packs o semanas no comparten
membership.

## 13. Deadline, abort e invalidación

El coordinador arma un deadline operativo para cada fase: la espera del primer
compromiso usa el mismo límite de 3 s que el health y la fase remota usa 15 s.
Al vencer, el callback cancela realmente el pipeline, aborta su
`AbortController`, publica un estado estable y limpia la referencia al timer.
La petición conserva además el deadline de `executeRemoteRequest()`, que cubre
headers y body y limpia timer/listener en `finally`. El reloj y las funciones
de timeout del coordinador son inyectables y se prueban con fake clock: no hay
polling ni un timer que solo cambie una etiqueta.

Login, logout, quitar/cambiar cuenta y cambiar pack invalidan el pipeline.
Cambio de cuenta/pack/semana o generación de conectividad hace fallar el guard
de contexto. Suspend aborta y publica un estado asentado; resume puede iniciar
un intento nuevo. Shutdown aborta, vacía identidades y referencias y deja el
coordinador detenido. Una respuesta tardía se descarta y no puede publicar
member sobre otro contexto.

## 14. Badge `Comprobando participación`

El texto exacto solo aparece cuando `membership.status === "checking"` y existe
`membership.resolution.active` con la misma cuenta, instancia, `weekId` y
generación. La resolución puede estar esperando el health inicial o ejecutando
el request; en el segundo caso existe también `request.inFlight:true`.

Su severidad es `progress`, representada por el azul del sistema. Readiness
marca membership como blocker, pone `canPlayCompetition:false` y comparte la
razón `Comprobando participación.`. Un `deferred` desnudo, un request terminado
o una identidad stale se normalizan a un estado no progresivo.

## 15. Resultado `Pack listo`

Cuando membership termina en `member` y la presentación local del pack está
`ready`, el badge principal es exactamente `Pack listo`, con severidad
`success` y color verde. Se elimina `Listo para competir` de esa superficie.

`not_member`, `requires_login`, `no_session`, `missing_week` e `invalid_week`
conservan sus modelos estables y accionables. Timeout, transporte, HTTP no
concluyente o body no JSON abandonan checking y terminan en error estable; no
infieren member, no habilitan submit y nunca producen `Pack listo`.

## 16. Gate de `Jugar`

La acción visible recupera el texto exacto `Jugar`. La misma etiqueta alimenta
texto, `aria-label` y `title` cuando no existe otra razón. Durante checking:

- presentación devuelve la razón `Comprobando participación`;
- el botón usa disabled nativo, `aria-disabled` y `aria-describedby`;
- readiness tiene `canPlayCompetition:false`;
- `shouldBlockCompetition()` incluye `checking`;
- el handler de `play-competition` rechaza también si el coordinador automático
  o una recomprobación manual están activos.

Práctica conserva su gate independiente. La política competitiva previa para un
error temporal estable se mantiene: si toda la readiness local lo permite,
`Jugar` puede volver a habilitarse para guardar la puntuación local, pero ese
estado no equivale a member, no permite submit y no muestra `Pack listo`.

## 17. Restauración de la copy

La etiqueta derivada de la acción principal cambia de `Competición` a `Jugar` y
la copy compartida pasa de `JUGAR` a `Jugar`. El modo técnico interno sigue
llamándose `competition`, al igual que IPC, argumentos de MAME y nombres de
servicio donde esa palabra describe el dominio y no el texto del botón.

## 18. Accesibilidad

- Precompromiso: sin texto, punto ni anuncio; chip y acción reservados usan
  `aria-hidden`, y el botón está fuera del tab order.
- Postcompromiso: texto más color; el punto CSS es decorativo.
- Refresh: botón nativo, nombre `Comprobar conexión`, `title`, foco visible,
  disabled/`aria-busy` y activación por teclado.
- `Jugar`: nombre accesible explícito, disabled nativo y razón asociada.
- Live: anuncia transiciones binarias útiles y resultados del log; no anuncia
  probes automáticos ni duplica el overlay manual.

El renderer conserva montaje único, listeners delegados, foco regional y
cleanup de observers.

## 19. Pruebas

La cobertura dirigida terminó en 210/210. Incluye presentación inicial oculta,
primer connected/offline, configuración terminal, conservación binaria en
probes, separación punto/SVG de acción, botón accesible, una llamada IPC,
doble click, overlay, error, stale run y cleanup.

`membership-startup-coordinator.test.js` cubre espera y connected inicial,
single request, sesión refrescable, prerrequisitos imposibles, retry por nueva
generación, timeout/HTTP/no JSON, cambios de cuenta/pack/week, A -> B -> A,
respuesta tardía, checking huérfano, suspend/resume/shutdown, deadlines con
fake clock, caches acotadas e inexistencia de polling. La integración con
`main` cubre autoridad monotónica de snapshots y efectos, trigger connected,
gate backend, pausa durante mutaciones concurrentes e invalidaciones. La señal
de abort cubre también el refresh de sesión. Presentación/readiness cubren
checking azul, `Pack listo`, ausencia de sesión, `Jugar`, disabled accesible y
política de error estable.

La suite completa del launcher terminó en 740/740 y la suite raíz en 9/9. El
único warning conocido fue el preexistente `MODULE_TYPELESS_PACKAGE_JSON`.

## 20. Smoke

`npm.cmd --prefix local/hsl-local-app run gui` arrancó sin error de terminal. Se
observaron cuatro procesos Electron y dos Node respondiendo. El cierre acotado
con `SIGINT` fue confirmado y no dejó procesos Electron, Node o npm residuales.

El entorno devolvió `MainWindowHandle 0` y no expuso la ventana. Por tanto no se
inspeccionaron físicamente el primer frame, el chip, el overlay, el click de
refresh ni membership real de Space Invaders v2. Esos recorridos se validaron
solo mediante fixtures y tests y permanecen como QA visual/real pendiente.

## 21. Riesgos residuales

La automatización demuestra las transiciones y guards, pero no sustituye:

- observar el primer frame en una ventana Electron visible;
- probar el refresh manual con ratón y teclado y una red realmente degradada;
- arrancar Space Invaders v2 con una cuenta miembro real;
- cambiar rápidamente entre dos cuentas y dos packs reales;
- cortar y recuperar Ethernet durante el pipeline;
- revisar contraste y foco en ambos temas y escalados físicos.

Por eso 4V.1B queda implementado y cubierto automáticamente, pero membership no
se declara cerrado para release sin el QA anterior. No se modificaron web,
Supabase, MAME, plugin, payload competitivo ni los trabajos visuales reservados
para 4V.2–4V.4.
