# LOCAL PRE-BETA ACCOUNT MEMBERSHIP CONNECTIVITY 4V.1A

## 1. Objetivo

4V.1A estabiliza tres traducciones entre estado técnico y producto sin cambiar
las autoridades canónicas: elimina el aviso de cuenta no accionable, impide que
membership aparente progreso sin un request vigente y reduce la conectividad
normal del header a `Conectado` o `Desconectado` con un punto CSS.

## 2. Base y árbol heredado de 4V.1

La base Git es `7b43fe6c55f19c97cda631a19740b1570106a3df` en
`master`. La autoridad de trabajo fue el árbol sin commit que ya contenía 4V.1:
feedback explícito de Ranking mediante el overlay común, guard contra doble
apertura, identidad por pack/semana/cuenta, pruebas, documentación y el primer
silenciamiento de `Cuenta cambiada.`. También estaba modificada la entrada
PR-001 de `launcher-pre-release-backlog-recovery-4v0.md`. No se descartó ni se
reconstruyó ninguno de esos cambios.

## 3. Aviso real de cuenta

El texto amarillo literal era `Sesión conservada`. El recorrido era:

```text
switch-account -> setActive -> getLauncherState -> snapshot aceptado
  -> session { hasSession: true, status: deferred, requiresLogin: false }
  -> deriveSessionPresentation()
  -> warning / Sesión conservada
  -> renderAccountMenu() -> account-session-state
```

`account-session-state` tenía color `--state-warning`. El aviso podía aparecer
con el snapshot posterior al cambio y reaparecer cada vez que el menú volvía a
derivarse. No procedía de `lastAction`, de una nota de cuenta ni de los logs. La
región live no anunciaba directamente esa derivación, pero 4V.1 sí tuvo que
silenciar por separado el log `Cuenta cambiada.`.

## 4. Regla de silenciamiento semántico

`deriveSessionPresentation()` marca explícitamente si hay acción requerida. Si
existe sesión local, no hay `requiresLogin` y el estado es autorrecuperable, la
presentación es normal y silenciosa. Los estados cubiertos son `deferred`,
`temporary-failure`, `cancelled`, `refreshing`, `stale`, `lock-timeout` y
`storage-unavailable`. Se conservan `recoveryPending` y `technicalStatus` como
metadata; no se borra el estado técnico.

`renderAccountMenu()` sólo crea el aviso cuando `actionRequired === true`.
`deriveRememberedAccountPresentation()` aplica la misma semántica a la fila de
una cuenta con sesión local para que `remoteUsable:false` temporal no produzca
otro warning equivalente. No hay `display:none`, toast sustitutorio, notice
verde ni contenedor vacío.

## 5. Mensajes accionables conservados

Siguen visibles los fallos explícitos de cambio o activación, `requiresLogin`,
sesión revocada, corrupta, ausente o incompatible, credenciales que ya no
permiten continuar, error terminal al leer/refrescar y cualquier respuesta
explícita fallida. El formulario conserva su `authError`, el email de la cuenta
y sus reglas efímeras. No se modifican repositorio, tokens, tombstones,
revisiones, cuenta activa, colas ni puntuaciones.

## 6. Lifecycle anterior de membership

La selección resuelve pack y `weekId`; `getLauncherContext()` obtiene la sesión
canónica, combina las señales de aborto global, lifecycle e interacción y
espera `checkSeasonMembership()`. La petición usa `executeRemoteRequest()` y
sólo después construye el snapshot completo. El renderer no recibe un snapshot
intermedio `checking` durante ese await; en una acción explícita ya conserva el
snapshot anterior y usa el feedback común.

El main invalida operaciones interactivas al cambiar cuenta o pack. Suspender y
cerrar abortan los controladores compartidos; reanudar crea un controlador
nuevo. La revisión monotónica del launcher descarta snapshots antiguos.

## 7. Causa del checking permanente

No se encontró una promesa remota sin deadline. El estado provisional lo
inventaba `deriveMembershipPresentation()` con esta equivalencia anterior:

```text
status unknown + checkedAt null + sin remoteFailure = checking
```

`deferRemoteMembership:true` devuelve deliberadamente `unknown`,
`checkedAt:null`, `technicalReason:"deferred"` y ningún request. La derivación
lo convertía en `Comprobando participación` y, al no existir operación que
fuese a completarlo, podía quedar así indefinidamente.

## 8. Timeout, abort e invalidación

4V.1A reutiliza el deadline remoto existente de 15 000 ms. El mismo timeout
cubre recepción de headers y consumo del body, aborta el `AbortController`,
gana la carrera frente a una respuesta tardía y limpia timer/listener en
`finally`. Timeout y abort producen `unknown` estable con `checkedAt` y
`remoteFailure`; 401 produce reautenticación; HTTP, body no JSON y transporte
producen los modelos estables ya existentes.

No se añadió timer visual. La señal interactiva se invalida en cambio de
cuenta/pack; el contexto de presentación exige la misma cuenta, instancia,
`weekId` y generación. Suspensión/cierre abortan; un reintento posterior usa el
controlador nuevo. El ledger y el guard de contexto impiden aplicar respuestas
stale.

## 9. Tratamiento de recomprobaciones

`checking` sólo se acepta si el objeto declara un request `inFlight`, vigente y
con identidad exacta de cuenta, instancia, `weekId` y generación. Un
`unknown` sin request ya es `Participación sin confirmar`, no progreso.

Para una recomprobación del mismo contexto, la región `game-status` conserva su
HTML anterior mientras el snapshot real está checking/deferred. La retención
usa el renderer regional existente y funciona también tras varios snapshots
deferred consecutivos; no crea store ni persiste estado visual. Las acciones y
readiness se renderizan siempre con el snapshot real, por lo que la retención
visual nunca autoriza competición o envío. Cuenta, instancia o `weekId`
distintos fuerzan una presentación nueva.

## 10. Proyección binaria de conectividad

`deriveConnectivityPresentation()` continúa modelando `unknown`, `checking`,
`connected`, `reconnecting`, `offline`, `suspended`, `probe-error` y problemas
de configuración para diagnóstico y razones de bloqueo.

La superficie normal usa el helper separado
`derivePublicConnectivityPresentation()`:

| Estado comprometido/configuración | Texto público | Punto | Live |
| --- | --- | --- | --- |
| `reachability: connected`, configuración válida | Conectado | verde | sólo al cambiar desde desconectado |
| `offline`, `unknown`, timeout o error sin confirmación | Desconectado | rojo | sólo al cambiar desde conectado |
| configuración `missing` o `invalid` | Desconectado | rojo | sólo si cambia el binario público |

## 11. Uso del último estado comprometido

La proyección sólo consulta `reachability`, que ya es el estado comprometido
por la gate, y la validez de configuración. Ignora `displayStatus`, fase del
probe y actividad para decidir el texto. Por eso un probe desde conectado
mantiene `Conectado`; una reconexión desde offline mantiene `Desconectado`; el
primer unknown parte desconectado. No se usa `navigator.onLine`, membership,
Ranking, biblioteca ni un error de producto como autoridad.

## 12. Punto verde y rojo

`renderConnectionControl()` crea un `span.connection-dot`. Es un círculo CSS de
8 × 8 px, tamaño fijo, sin animación, assets ni fallback. El chip tiene anchura
fija de 118 px para que el cambio de copy no desplace el header. Los tokens
`--state-success` y `--state-error` dan color y contraste en ambos temas.

## 13. Eliminación de SVG en la superficie normal

El bloque de conectividad ya no llama `renderIcon()`: desaparecen el icono de
estado y el botón/icono refresh del chip normal. También se retiraron sus reglas
CSS muertas. El listener y la operación de refresh siguen disponibles para los
flujos internos/avanzados existentes; no se cambió la API de conectividad.

## 14. Accesibilidad

El texto visible siempre es `Conectado` o `Desconectado`; el color no es el
único canal. El punto es decorativo con `aria-hidden="true"`. La región live
compara las dos proyecciones binarias y sólo anuncia `Conectado` o
`Desconectado` en una transición real. Probes, reconexiones internas y
repeticiones del mismo binario no anuncian nada.

## 15. Pruebas

La cobertura focalizada caracteriza cuenta, membership y conectividad en
`account-membership-connectivity-presentation.test.js`, y actualiza las pruebas
de presentación, integración de conectividad/Ranking, jerarquía del renderer y
consistencia de la gate. Reutiliza las pruebas existentes de membership y
remote request para member/not_member, 401, 500, no JSON, transporte, deadline,
abort y cleanup. Las suites de lifecycle ya cubren cancelación por cuenta,
pack, suspend, resume, cierre y rechazo de revisiones stale.

Resultado final: pruebas dirigidas 63/63, suite completa del launcher 701/701 y
suite raíz 9/9. Sólo apareció el warning preexistente
`MODULE_TYPELESS_PACKAGE_JSON`. `git diff --check` no encontró errores de
whitespace; Git sólo avisó de la conversión futura LF→CRLF propia del entorno.

## 16. Smoke

`npm.cmd --prefix local/hsl-local-app run gui` arrancó el launcher real y se
confirmaron el proceso npm/Node y cuatro procesos Electron sin salida de error.
Tras la ventana de observación se cerró deliberadamente con `Ctrl+C`; npm terminó
con código 1 por el `SIGINT` esperado y no quedó ningún proceso Electron, Node o
npm del launcher.

El entorno no permitió automatizar clics dentro de esa BrowserWindow ni aportó
dos cuentas reales, una cuenta revocada o control físico de red. Por ello el
arranque/cierre es real, mientras que cambio de cuenta, timeout/abort/stale de
membership, probes, configuración inválida, temas y transiciones binarias se
validaron con snapshots/fixtures y pruebas de integración. El recorrido visual
real de dos cuentas, Space Invaders v2 y corte/reconexión de red permanece QA
pendiente; no se declara como realizado.

## 17. Riesgos residuales

La validación automatizada reproduce exactamente las formas de snapshot, pero
no sustituye una interacción física con dos cuentas reales, un corte real de
red ni la observación visual de ambos temas. Esos recorridos deben declararse
pendientes si el entorno Electron no permite realizarlos. El warning
`MODULE_TYPELESS_PACKAGE_JSON` permanece preexistente y no afecta al contrato.

## 18. Trabajo reservado para 4V.2

4V.2 conserva el alcance ya registrado en el backlog: geometría y densidad de
biblioteca (CON-001/PR-002). El QA real residual de cuenta, Space Invaders y red
permanece en SOL-006/PR-006/PR-008 y sólo debe generar una corrección separada si
descubre un P0/P1 reproducible. No se arrastran a 4V.2 polling, nuevas APIs,
rediseño de header/menú/panel, cambios web, catálogo, updater, MAME, plugin,
ubicación ni payload competitivo.
