# LOCAL PRE-BETA ACCOUNT MEMBERSHIP CONNECTIVITY 4V.1A

## 1. Objetivo

4V.1A estabiliza tres traducciones entre estado técnico y producto sin cambiar
las autoridades canónicas: elimina el aviso de cuenta no accionable, impide que
membership aparente progreso sin un request vigente y reduce la conectividad
normal del header a `Conectado` o `Desconectado` con un punto CSS.

> Corrección posterior 4V.1B: dos decisiones de 4V.1A resultaron incompletas.
> Proyectar el `unknown` inicial como `Desconectado` introducía un falso negativo
> antes del primer compromiso, y retirar junto con los SVG de estado el botón
> independiente de refresh eliminó una acción válida. 4V.1B conserva el binario
> público después del primer compromiso, oculta antes todo contenido de estado y
> recupera el refresh como acción separada con su SVG local. También cierra la
> convergencia inicial de membership que 4V.1A no llegó a orquestar.

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

4V.1A corrigió esa afirmación falsa de progreso, pero dejó un problema residual:
el mismo snapshot diferido pasó a mostrarse como `Participación sin confirmar`
sin programar una petición posterior. El listener de conectividad solo
actualizaba Ranking y autoenvío; no iniciaba membership. Por eso el arranque con
pack, cuenta y sesión recordados podía quedarse indefinidamente en ese estado.
Cambiar de pack o cuenta lo resolvía incidentalmente porque esas acciones
acababan solicitando un `getLauncherState()` no diferido. 4V.1B mueve esa
convergencia a un coordinador acotado en `main`, independiente de la vista.

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

`checking` sólo se acepta si el objeto declara una resolución vigente con
identidad exacta de cuenta, instancia, `weekId` y generación. 4V.1B usa
`membership.resolution` durante la espera acotada del primer compromiso de
conectividad y añade `request.inFlight` durante la consulta remota. Un
`unknown` sin operación no es progreso; una mera respuesta `deferred` tampoco.

Para una recomprobación del mismo contexto, la región `game-status` conserva su
HTML anterior mientras el snapshot real está checking/deferred. La retención
usa el renderer regional existente y funciona también tras varios snapshots
deferred consecutivos; no crea store ni persiste estado visual. Las acciones y
readiness se renderizan siempre con el snapshot real, por lo que la retención
visual nunca autoriza competición o envío. Cuenta, instancia o `weekId`
distintos fuerzan una presentación nueva.

La excepción necesaria es el primer `deferred`: no se conserva como resultado
estable por delante del primer `checking` real. Así desaparece
`Participación sin confirmar` cuando el coordinador comienza, sin producir un
remount ni usar el componente como trigger de red.

## 10. Proyección binaria de conectividad

`deriveConnectivityPresentation()` continúa modelando `unknown`, `checking`,
`connected`, `reconnecting`, `offline`, `suspended`, `probe-error` y problemas
de configuración para diagnóstico y razones de bloqueo.

La superficie normal usa el helper separado
`derivePublicConnectivityPresentation()`:

| Estado técnico actual | Primer resultado comprometido | Contenido público | Punto | Live |
| --- | --- | --- | --- | --- |
| `unknown` inicial o probe inicial activo | no | oculto y `aria-hidden`; no se crea tercer texto | ninguno | no |
| `reachability: connected`, configuración válida | sí | `Conectado` | verde | al aparecer por primera vez o cambiar el binario, salvo duplicación con el overlay manual |
| `reachability: offline` | sí | `Desconectado` | rojo | al aparecer por primera vez o cambiar el binario, salvo duplicación con el overlay manual |
| configuración `missing` o `invalid` | sí, resolución terminal local | `Desconectado` | rojo | solo si aporta una transición binaria real |

El helper mantiene `connected`/`disconnected` como única proyección binaria,
pero añade `committed` para decidir si el header puede hacerla visible. No hay
un tercer estado público.

## 11. Uso del último estado comprometido

La proyección sólo consulta `reachability`, que ya es el estado comprometido
por la gate, y la validez de configuración. Ignora `displayStatus`, fase del
probe y actividad para decidir el texto. Por eso un probe desde conectado
mantiene `Conectado` y una reconexión desde offline mantiene `Desconectado`. La
decisión anterior de hacer que el primer `unknown` partiera visualmente
desconectado fue incorrecta: ahora el contenedor reserva geometría, pero no
presenta texto, punto, status ni anuncio hasta que `reachability` sea
`connected`/`offline` o la configuración remota termine en `missing`/`invalid`.
No se usa `navigator.onLine`, membership, Ranking, biblioteca ni un error de
producto como autoridad.

## 12. Punto verde y rojo

`renderConnectionControl()` crea un `span.connection-dot`. Es un círculo CSS de
8 × 8 px, tamaño fijo, sin animación, assets ni fallback. El chip tiene anchura
fija de 118 px para que el cambio de copy no desplace el header. Los tokens
`--state-success` y `--state-error` dan color y contraste en ambos temas.

4V.1B reserva el bloque completo de conectividad, incluido el espacio de la
acción, con anchura fija. Antes del primer compromiso el chip no contiene texto
ni punto y el botón está oculto, deshabilitado y fuera del orden de tabulación;
la posterior aparición del binario y del botón no desplaza el header.

## 13. Indicador de estado frente a icono de acción

4V.1A acertó al retirar los SVG de check/cross como representación del estado,
pero eliminó incorrectamente a la vez el botón manual de refresh. Son contratos
distintos:

- el indicador sigue siendo exclusivamente punto CSS verde/rojo más texto
  binario, sin SVG;
- el botón restaurado es una acción nativa separada y puede usar el SVG local
  `refresh` porque no representa reachability.

La acción reutiliza el IPC y el servicio de conectividad existentes. Su retorno
no parchea el chip directamente: el cambio visible continúa llegando por el
evento de la autoridad de conectividad.

## 14. Accesibilidad

Después del primer compromiso, el texto visible siempre es `Conectado` o
`Desconectado`; el color no es el único canal. Antes de él, el contenido
reservado usa `aria-hidden="true"`, no contiene texto ni punto y no llega a la
región live. El punto comprometido es decorativo. El botón independiente tiene
nombre `Comprobar conexión`, `title`, foco visible, activación nativa por teclado
y estado disabled/`aria-busy` durante la operación.

La región live anuncia únicamente un primer resultado comprometido o un cambio
binario real. Mientras el overlay manual ya comunica
`Comprobando conexión...`, no duplica ese feedback. Probes automáticos,
reconexiones internas y repeticiones del mismo binario siguen silenciosos.

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

Esas cifras corresponden al cierre de 4V.1A. 4V.1B añade cobertura conductual
para precompromiso oculto, geometría reservada, refresh accesible y single-shot,
overlay y cleanup, probes automáticos silenciosos, coordinador inicial,
deduplicación, member/not_member/errores, timeout, abort, stale, suspend/resume,
gate frontend/backend, `Pack listo` y copy `Jugar`. Sus cifras finales deben
tomarse del informe de 4V.1B, no inferirse de este resultado histórico.

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

Este smoke de 4V.1A tampoco prueba la ausencia del destello en el primer frame,
la visibilidad del refresh restaurado ni la convergencia real de membership de
4V.1B. Esos puntos siguen requiriendo observación física; los fixtures y tests
automatizados no se presentan como sustituto.

## 17. Riesgos residuales

La validación automatizada reproduce exactamente las formas de snapshot, pero
no sustituye una interacción física con dos cuentas reales, un corte real de
red ni la observación visual de ambos temas. Esos recorridos deben declararse
pendientes si el entorno Electron no permite realizarlos. El warning
`MODULE_TYPELESS_PACKAGE_JSON` permanece preexistente y no afecta al contrato.

4V.1B cierra el defecto de orquestación en código, pero membership no debe darse
por cerrado para release hasta completar QA real con Space Invaders v2, una
cuenta miembro, cambios rápidos de cuenta/pack y red disponible/no disponible.

## 18. Trabajo reservado para 4V.2

4V.2 conserva el alcance de biblioteca registrado en el backlog: geometría y
densidad (CON-001/PR-002), continuidad de `scrollTop` al cambiar de pack y el
espaciado de la cabecera/selector. El QA real residual de cuenta, Space Invaders
y red permanece en SOL-006/PR-006/PR-008 y sólo debe generar una corrección
separada si descubre un P0/P1 reproducible. No se arrastran a 4V.2 polling,
nuevas APIs, cambios web, catálogo, updater, MAME, plugin, ubicación canónica ni
payload competitivo.

## 19. Resultado de la corrección 4V.1B

4V.1B sustituye expresamente estas conclusiones de 4V.1A:

1. `unknown` inicial ya no significa `Desconectado` visible; significa espacio
   reservado sin contenido hasta el primer resultado comprometido.
2. El SVG sigue prohibido como estado, pero vuelve a estar permitido como icono
   del botón independiente `Comprobar conexión`.
3. El snapshot inicial `unknown/deferred` no se considera resultado de
   membership ni puede quedar como `Participación sin confirmar`: el
   coordinador de `main` inicia una resolución real cuando convergen pack,
   cuenta, sesión, conectividad y lifecycle.
4. Solo ese pipeline identificado puede mostrar `Comprobando participación`;
   bloquea `Jugar` en presentación, readiness y backend.
5. `member` confirmado con pack local preparado termina en `Pack listo`; un
   error temporal abandona checking sin inferir member y conserva la política
   competitiva offline ya existente.

La validación final de 4V.1B cubre 210/210 pruebas dirigidas, 740/740 en la
suite completa del launcher y 9/9 en la suite raíz. El detalle de QA real frente
a fixtures permanece en su documento específico.
