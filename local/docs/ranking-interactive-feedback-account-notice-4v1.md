# LOCAL PRE-BETA RANKING FEEDBACK ACCOUNT NOTICE 4V.1

Corrección acotada del feedback de la acción explícita de Ranking y del aviso
redundante tras un cambio normal de cuenta. No cambia autoridades remotas,
sesiones, colas ni contratos de producto.

## Base y estado inicial

Base verificada: `7b43fe6c55f19c97cda631a19740b1570106a3df`, rama
`master`, árbol limpio. `git diff --check` no informó problemas. Herramientas:
Node `v24.18.0` y npm `12.0.1`.

En el baseline pasaban 684 pruebas del launcher y 9 pruebas raíz. El único
warning repetido era el preexistente `MODULE_TYPELESS_PACKAGE_JSON` al importar
módulos ESM del renderer desde `node --test`. No había un proceso Electron o
Node residual; la consulta de procesos sólo coincidió con su propio PowerShell
porque la línea de comandos contenía el patrón buscado.

## Reconstrucción del flujo anterior

### Ranking

El batch automático de capacidades ya era correcto y silencioso:

```text
main/rankingCapabilities -> evento IPC -> applyRankingCapabilitiesState()
  -> store.rankingCapabilities -> render regional
```

No activaba `busy`, overlay ni región viva. La intención explícita seguía otro
camino:

```text
clic open-ranking -> openRankingWithoutGlobalBusy()
  -> rankingOpening=true -> IPC openRanking()
  -> main valida conexión comprometida, sesión, capacidad, origen y weekId
  -> shell.openExternal() o motivo semántico
  -> log + rankingOpening=false
```

El botón quedaba deshabilitado y existía un booleano contra doble apertura,
pero no se montaba el overlay común. Por eso el primer pintado posterior al clic
podía resultar demasiado sutil aunque la autoridad del main fuese correcta.

### Cambio de cuenta (hallazgo inicial incompleto)

`switchAccount()` añadía siempre este resultado al log del renderer:

```js
logs: appendLog(store.getState().logs, resultToLog("Cambiar cuenta", response))
```

En una activación normal el servicio devolvía `action: "switch-account"`,
`ok: true` y `summary: "Cuenta cambiada."`. El log no sólo aparecía en la
superficie de mensajes: al cambiar `logs`, `deriveLiveAnnouncement()` enviaba
el mismo resumen a `#hsl-live-status`. Esa era una causa real de ruido, pero no
era el aviso amarillo del reporte. 4V.1 silenció correctamente
`Cuenta cambiada.`, aunque dio por cerrada la incidencia demasiado pronto.

La caracterización posterior de 4V.1A localizó el texto amarillo literal
`Sesión conservada`. Lo generaba `deriveSessionPresentation()` cuando la cuenta
activa tenía una sesión local almacenada y el estado técnico era `deferred`,
`temporary-failure` o `cancelled`. `renderAccountMenu()` lo volvía a derivar en
cada apertura y montaba `account-session-state`; su CSS usaba el color warning.
Por eso podía aparecer con el snapshot posterior al cambio o reaparecer al
abrir otra vez el menú aunque el log de éxito ya fuese silencioso. El aviso no
nacía de `lastAction`, del log ni del repositorio de sesiones.

## Contrato aplicado a Ranking

`openRankingWithOperationFeedback()` reutiliza `runWithOperationFeedback`, el
store `busy` y `renderBusyOverlay()`. No crea otro overlay ni otra infraestructura
de operación.

- sólo el clic explícito inicia feedback visible;
- el batch y los eventos automáticos de capacidades continúan silenciosos;
- como el botón sólo está disponible con una capacidad ya confirmada, la fase
  visible empieza directamente en `Abriendo ranking...`; no se inventa una
  segunda comprobación;
- `scope: "external"` evita un retardo artificial al abrir el navegador;
- `onStart` registra el `runId` del runner y activa `busy`, `busyLabel` y
  `rankingOpening` en una única transición;
- la presencia de un run activo o de otra operación `busy` rechaza un segundo
  clic antes de llamar al IPC;
- el resultado normal conserva exactamente una llamada a `openRanking()` y el
  main conserva exactamente una apertura externa autorizada;
- un resultado semántico no disponible cierra el overlay, reactiva la acción y
  muestra el motivo devuelto, sin abrir una URL;
- una excepción IPC cierra el overlay y publica `No se pudo abrir el ranking.
  Inténtalo de nuevo.`;
- ni el runner ni el renderer escriben conectividad. La única disponibilidad
  sigue procediendo de la gate remota comprometida.

El overlay ya existente presenta `Abriendo ranking...` y `Mostrando la
clasificación del juego.` con `role="status"`, `aria-live="polite"` y
`aria-busy="true"`. `rankingOpening` mantiene deshabilitada la acción semántica
y el cierre produce un solo resumen final en la región viva, sin popup nuevo.

## Identidad y lifecycle

Cada apertura captura una identidad semántica compuesta por instancia de pack,
`weekId` y cuenta activa. El `runId` decide qué callback puede cerrar o publicar
el feedback; la identidad decide si el resultado aún pertenece a la selección
visible.

- un snapshot aceptado de otro pack, semana o cuenta invalida el run y limpia
  `busy`, `busyLabel` y `rankingOpening`;
- una respuesta cuyo snapshot ya pertenece a otro contexto se descarta sin
  log ni mutación de la presentación actual;
- una respuesta tardía de un run invalidado no puede cerrar una operación más
  nueva;
- `beforeunload` elimina la identidad activa antes de retirar suscripciones y
  recursos del renderer;
- cierre, error, cancelación por contexto, cambio de pack/cuenta y respuesta
  stale convergen en un estado sin overlay huérfano;
- el main mantiene su comprobación `activeRankingWeekId === weekId`, por lo que
  un cambio de pack durante el await tampoco alcanza `shell.openExternal()`.

No se añadió `AbortSignal` al bridge IPC porque la autoridad del main ya cancela
la aplicación semántica y el cierre de BrowserWindow destruye el contexto. El
renderer sólo invalida su feedback visual.

## Contrato aplicado al cambio de cuenta y corrección 4V.1A

`shouldSurfaceAccountSwitchResult()` sigue siendo la política pura para el
resultado explícito:

- `switch-account` con éxito normal no crea log, toast, banner ni anuncio live;
- `ok: false` sigue visible;
- `requiresLogin: true` y `switch-account-login-required` siguen visibles y
  reabren el formulario con el email y el error correspondiente;
- una respuesta ausente o inesperada falla de forma conservadora y no se
  silencia;
- una excepción sigue mostrando `No se pudo cambiar de cuenta` y conserva el
  camino de reautenticación.

4V.1A completa la política en la presentación de sesión: una sesión local
almacenada, sin `requiresLogin` y con recuperación automática pendiente se
proyecta como sesión normal y no crea aviso en el menú ni una variante verde
equivalente. Esto cubre `deferred`, `temporary-failure`, `cancelled`,
`refreshing`, `stale`, `lock-timeout` y `storage-unavailable`; el estado técnico
se conserva como metadata de la presentación y las gates remotas continúan
leyendo el snapshot real. La misma regla evita que la fila activa muestre
`Cuenta recordada` sólo porque `remoteUsable` sea temporalmente falso.

Permanecen visibles el fallo explícito al cambiar o activar cuenta,
`requiresLogin`, sesión revocada, corrupta o incompatible, credenciales
inválidas, error terminal de lectura/refresh y cualquier situación que requiera
una acción del usuario. `renderAccountMenu()` sólo crea
`account-session-state` cuando la derivación marca `actionRequired: true`; no
queda un contenedor vacío. No se modificaron `switchKnownAccountFromGui()`,
`setActive()`, resolución o refresh de sesiones, secretos, revisión monotónica,
cuentas recordadas, scope de colas, autoenvío ni cierre del menú.

## Cobertura

La tarea añade pruebas conductuales y de integración enfocadas en:

1. feedback mínimo compartido en éxito y error;
2. scopes interactivo, externo y background sin espera artificial;
3. run stale incapaz de finalizar otro feedback;
4. guard de doble clic antes del IPC;
5. una sola llamada renderer a `openRanking()`;
6. uso de `runWithOperationFeedback` y `scope: external`;
7. activación atómica de `busy`, copy y `rankingOpening`;
8. overlay con el copy de apertura existente;
9. `role=status`;
10. `aria-live=polite`;
11. `aria-busy=true`;
12. actualización automática de capacidades sin overlay;
13. invalidación por identidad semántica;
14. descarte del snapshot de respuesta de otro contexto;
15. cleanup en `beforeunload`;
16. error de apertura con copy de jugador;
17. cierre del feedback tras resultado no disponible;
18. gate de Ranking para offline;
19. gate para conexión en comprobación;
20. gate para capacidad unknown;
21. gate para capacidad unavailable;
22. apertura sólo con capacidad available;
23. URL same-origin segura;
24. ausencia de refresh de conectividad provocado por el clic;
25. ausencia de autoridad de red en renderer;
26. misma gate comprometida para chip y Ranking;
27. recuperación de Ranking tras conectividad confirmada;
28. botón deshabilitado durante apertura;
29. reactivación tras terminar;
30. apertura sin `weekId` bloqueada;
31. éxito normal de cuenta clasificado como silencioso;
32. fallo de cuenta clasificado como visible;
33. login requerido clasificado como visible;
34. respuesta de cuenta inesperada clasificada como visible;
35. log normal condicionado por la política de presentación;
36. formulario de login conservado para `requiresLogin`;
37. excepción de cuenta conservada;
38. menú cerrado tras cambio normal;
39. menú abierto tras reautenticación;
40. cambio de cuenta sin modificar el servicio de sesión.

La ejecución dirigida posterior al cambio pasó 35/35 pruebas. Las suites
completas finales pasaron 689/689 pruebas del launcher y 9/9 pruebas raíz.

`npm.cmd --prefix local/hsl-local-app run gui` abrió el launcher real y mantuvo
cuatro procesos Electron respondiendo, sin salida de error durante la ventana de
observación. El smoke se cerró deliberadamente con `Ctrl+C`; npm informó
`electron.exe exited with signal SIGINT` y el proceso del comando terminó con
código 1 por esa interrupción manual. Tras confirmar el cierre no quedó ningún
`electron.exe` residual.

El entorno no expuso una vía de automatización visual de esa BrowserWindow ni
cuentas/Ranking reales apropiados para accionar los dos recorridos. Por tanto,
el arranque y cierre real quedan comprobados, pero el doble clic físico, los
estados visibles de éxito/error y el cambio entre dos cuentas reales permanecen
como QA visual pendiente; no se sustituyen por la inspección estática.

## Fuera de alcance preservado

No se cambian geometría ni iconos de biblioteca, readiness del primer viewport,
flujo de ubicación, drawers, menús, resumen MAME, loader, footer, Ranking
embebido, API/web de Ranking, catálogo, updater, CSP, políticas Electron,
sesiones/tokens/refresh, colas, ledger, autoridad de conectividad, cache/URL de
Ranking, startup, temas, assets, importación ni selección salvo el cleanup
visual mínimo ligado a la identidad del run.

## Commit sugerido

`Añadir feedback de Ranking y limpiar cambio de cuenta`
