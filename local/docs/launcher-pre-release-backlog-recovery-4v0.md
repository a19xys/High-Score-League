# Backlog canónico pre-release del launcher — 4V.0

## 1. Resumen ejecutivo

Este documento reconstruye el backlog visual y funcional del launcher a partir
de **todos** los archivos actuales de `local/docs`, su cadena documental y las
diez peticiones externas recuperadas de la conversación. No es una auditoría
del runtime ni una autorización para implementar todo lo citado como futuro.

Base de lectura: commit
`a56976f5c1e3ec21c28512cc3934d8be8ede7840` (`Consolidar estados de
producto`), rama `master`. Al iniciar 4V.0 había cambios preexistentes en web y
en `docs/`, fuera de `local/docs`; se preservan y no se usan para inferir el
estado del launcher.

En el censo original de 4V.0 se localizaron 102 archivos fuente bajo
`local/docs`; los 102 estaban versionados, fueron legibles y se leyeron
completos. El apéndice conserva ese censo histórico sin renumerarlo. Los
documentos de continuidad creados por 4V.0, 4V.1, 4V.1A y 4V.1B quedan fuera de
esas 102 filas y actualizan el estado de los candidatos sin falsear la cobertura
de partida.

El resultado actualizado es un conjunto de 51 candidatos. Solo 22 forman backlog
antes o dentro de Release Candidate. Los restantes son trabajo posterior,
propuestas sin aprobación, contratos ya resueltos, decisiones obsoletas o
contradicciones que deben aclararse antes de editar.

## 2. Metodología

1. Se comparó el inventario físico recursivo con `git ls-files local/docs`.
2. Se leyó íntegramente cada archivo actual, incluidos JSON, Lua y README de la
   plantilla v2.
3. Se siguieron en cada documento las secciones de continuidad, actualización,
   corrección, hotfix, sustitución, deprecación y riesgos residuales.
4. Las búsquedas de términos de backlog y de conceptos concretos se usaron solo
   como comprobación de cobertura después de la lectura contextual.
5. Se consultó exclusivamente el historial Git de `local/docs` para ordenar las
   contradicciones de geometría, Ranking, renderer, importación y cuenta.
6. Los `Fuera de alcance` solo se elevaron a backlog cuando otro documento o la
   conversación aporta intención y continuidad suficientes.
7. Cuando la documentación no prueba el runtime se usa `requiere contraste
   técnico posterior`; no se inspeccionaron renderer, main, servicios ni tests.

## 3. Cobertura documental

| Métrica | Resultado |
| --- | --- |
| Archivos físicos del censo fuente 4V.0 | 102 |
| Archivos versionados del censo fuente 4V.0 | 102 |
| Leídos completamente en el censo fuente | 102 |
| No legibles | 0 |
| Físicos no versionados | 0 |
| Versionados ausentes físicamente | 0 |
| Eliminados o renombrados en historial | 0 |
| Referencias `.md` sin basename actual en `local/docs` | `docs/launcher-api.md`, referencia externa a esta carpeta, no documento perdido |

La cobertura archivo por archivo figura en el apéndice. `Leído: sí` significa
lectura completa, no que se haya comprobado la implementación descrita. Los
documentos de continuidad posteriores no se insertan retroactivamente en esas
filas ni cambian su numeración.

## 4. Fuentes externas aportadas por el usuario

Estas entradas no se atribuyen a `local/docs` salvo cuando existe evidencia
adicional explícita:

| Fuente externa | IDs conservados | Relación documental |
| --- | --- | --- |
| A. Feedback explícito de Ranking | PR-001 | `operation-feedback-lifecycle-1.md` silencia el batch automático, pero no documenta feedback de la acción explícita. |
| B. Cuatro iconos por fila | PR-002 | Las correcciones 7–10 documentan 122 px, gap 8 px y cuatro columnas a 600 px. |
| C. Readiness de imágenes del primer viewport | PR-003 | 3B.2 espera solo hero/logo del detalle inicial; no cubre todas las imágenes visibles de la vista inicial. |
| D. Flujo unificado de ubicación | PR-004 | El contrato de raíz y recuperación cubre clasificación/rechazo, no documenta íntegramente un popup único ni la regla completa de `defaultPath`. |
| E. Loader de doce frames | RC-004 | La especificación exacta no aparece en los 102 archivos del censo fuente. |
| F. Sesiones silenciosamente renovables | SOL-002 y PR-005 | El contrato está documentado; la validación real de staging y política Supabase sigue pendiente. |
| G. Badges iniciales de Space Invaders v2 | PR-006 | 3B.2 y 3B.3 aportan mitigaciones documentadas, pero no existe QA real específica de ese recorrido. |
| H. Selector de Biblioteca: continuidad y espaciado | PR-011 | Conservar `scrollTop` del panel izquierdo al cambiar de pack y reducir el hueco entre `Biblioteca` y ubicación/filtros; se agrupa con 4V.2 y PR-002. |
| I. Favorito y `Pack listo` en el hero | PR-012 | Retirar la estrella junto al título y reservar para 4V.3 la composición adaptable de favorito y readiness en la esquina inferior derecha del hero. |
| J. Presentación de `Olvidar cuenta` | PR-013 | Reservar para 4V.4 un hover/foco redondeado y azul, manteniendo la semántica destructiva por nombre accesible y comportamiento. |

### Continuidad 4V.1–4V.1B

- PR-001 permanece implementado por 4V.1 y con QA visual física pendiente; no se
  reclasifica como cerrado por sus pruebas automatizadas.
- 4V.1A corrigió el aviso no accionable de sesión y el falso checking de
  membership, pero su fallback `unknown -> Desconectado`, la retirada del botón
  refresh y la falta de convergencia inicial fueron decisiones incompletas.
- 4V.1B corrige esas tres partes, restaura `Jugar` y `Pack listo`, y termina con
  210/210 pruebas dirigidas, 740/740 del launcher y 9/9 raíz. El smoke confirmó
  arranque/cierre y ausencia de procesos residuales, pero no expuso una ventana;
  primer frame, click real y membership real de Space Invaders v2 siguen QA
  pendiente. Por ello PR-006 y PR-008 no se cierran para release.

## Matriz canónica de candidatos

### Recuento por clasificación principal

| Clasificación | Número |
| --- | ---: |
| Petición explícita recuperada | 5 |
| Contrato documentado vigente | 1 |
| Regresión documental probable | 1 |
| Parcialmente resuelto | 4 |
| Pendiente técnico documentado | 8 |
| QA o validación pendiente | 8 |
| Propuesta de Codex no aprobada | 5 |
| Obsoleto o sustituido | 6 |
| Solucionado documentalmente | 8 |
| Requiere contraste técnico posterior | 2 |
| Requiere confirmación del usuario | 3 |
| **Total** | **51** |

### Antes de Release Candidate

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PR-001 Feedback de acción Ranking | La pulsación explícita debe mostrar comprobando/abriendo/error, impedir doble apertura y cerrar feedback sin alterar conectividad; el batch automático sigue silencioso. | Conversación A; `operation-feedback-lifecycle-1.md`, “Scopes” y cierre; `ranking-session-verification-1.md`, triggers; `ranking-interactive-feedback-account-notice-4v1.md`, contrato y cobertura. Externa posterior a 3B.3. | Petición explícita recuperada | antes de RC · implementado; QA visual pendiente · alta | 3B.3 + gate Ranking; botón, overlay y live region | Mitigado en 4V.1 con runner común, runId e identidad pack/semana/cuenta; no se tocó health | Feedback inmediato solo para intención del usuario; runId; error/cierre; sin doble apertura ni falso estado global. Cubierto por pruebas; pendiente recorrido visual real. | conversación + apoyo documental + implementación 4V.1 |
| PR-002 Cuatro Iconos en ancho máximo | Cuatro tiles completos por fila restaurados dentro del máximo vigente tras eliminar insets duplicados y contabilizar gap, scrollbar y gutter; sin ampliar la sidebar. | Conversación B; `library-micropolish-sort-scroll-7.md`, “Iconos”; correcciones 9–10; `library-geometry-account-polish-4v2-4.md`. | Regresión documental corregida | antes de RC · implementado en 4V.2; observado en BrowserWindow fixture · alta | 3B.1; sidebar, grid y preferencias | Mitigado sin ampliar el máximo: geometría aislable, detalle mínimo y overflow probados junto a PR-011 | Cuatro tiles observados a `600 px`, cero overflow X, detalle utilizable, `Home → 440 px` y preferencia estable; queda QA con biblioteca y escalado físico reales. | conversación + documentación + implementación 4V.2 |
| PR-003 Readiness del primer viewport | Startup debe esperar imágenes realmente visibles de Portadas/Lista/Iconos, cargadas/decodificadas/renderizadas o con fallback, sin esperar fuera del viewport. | Conversación C; `launcher-startup-theme-assets-3b2.md`, pasos 7–11 y “Readiness”; `hero-logo-list-preload-13.md`. 3B.2 solo cubre detalle. | Parcialmente resuelto | antes de RC · parcial · alta | 3B.2 + 3B.1; startup, viewport y assets | P0 si se reabre autoridad generacional · tarea readiness viewport | Gate acotada por vista y viewport, decode/fallback definitivo, timeout degradado y cleanup; sin red/remount. | conversación + documentación |
| PR-004 Flujo unificado de ubicación | Un único flujo debe tratar raíz, pack-root, inside-pack, missing e invalid; solo una aceptación cambia la raíz y `defaultPath` siempre nace de la raíz canónica. | Conversación D; `library-root-contract-1.md`, clasificación/rechazo; `pack-directory-missing-flow-1.md`; `pack-directory-model-1.md`. | Parcialmente resuelto | antes de RC · parcial · alta | 3A/3B.1; selector, diálogos, raíz y selección | P0 si pack activo y raíz se mezclan · tarea ubicación/recuperación | Un diálogo coherente; cancel/rechazo no escriben; pack seleccionado no cambia raíz ni siguiente `defaultPath`; pruebas de todos los candidatos. | conversación + documentación |
| PR-005 Protocolo Auth real de staging | Ejecutar los 17 pasos con expiración, rotación, dos consumidores, red, revoke, relogin y pending, además del checklist Supabase. | `canonical-account-sessions-stabilization-2.md`, “Protocolo exacto de staging”; `persistent-account-sessions-1.md`, checklist; risk register. Julio 2026. | QA o validación pendiente | antes de RC · pendiente · alta | autoridad de sesiones; app empaquetada + Supabase staging | P0 si se “arregla” código antes de medir · tarea QA Auth | Tabla sanitaria de 17 pasos, revisiones monotónicas, una rotación ganadora y pending nunca perdido. | documentación |
| PR-006 Estado inicial Space Invaders v2 | Confirmar que el pipeline automático termina sin badges provisionales permanentes ni duplicados antes del estado estable. | Conversación G; `launcher-startup-theme-assets-3b2.md`; `launcher-product-state-presentation-3b3.md`; `account-membership-connectivity-presentation-4v1a.md`; `connectivity-membership-startup-4v1b.md`. | QA o validación pendiente | antes de RC · convergencia implementada en 4V.1B; QA visual y membership real pendientes · alta | 3B.2/3B.3 + coordinador 4V.1B; startup, detalle, cola | Alto si se parchea con delay o copy local · QA de estado real | Tests cubren checking real, deduplicación, `Pack listo` y gate `Jugar`; falta observar el recorrido completo con pack y cuenta miembro reales, sin falso listo ni duplicados. | conversación + documentación + implementación 4V.1A/4V.1B |
| PR-007 Backend seguro de sesiones por plataforma | Verificar `safeStorage` y keyring real; el fallback `basic_text`/0600 no debe presentarse como cifrado ni cerrar release sin decisión. | `secure-session-storage-1.md`; `canonical-account-sessions-stabilization-2.md`, riesgos; `connectivity-final-risk-register-3.md`, P0 condicional. | QA o validación pendiente | antes de RC · pendiente · alta | sesiones canónicas; packaging Windows/macOS/Linux | P0 de secretos si se oculta el degradado · tarea QA seguridad | Matriz por SO/backend, recuperación de `storage-unavailable`, diagnóstico sin secretos y criterio release explícito. | documentación |
| PR-008 Conectividad, deployment y cooldown físicos | Validar deploy con SHA, primer frame, refresh manual, Ethernet foco/sin foco/minimizado, 429/503, suspend/resume y recuperación conjunta de controles. | `deployment-fingerprint-1.md`; `connectivity-ranking-reliability-2.md`; risk register; `offline-recovery-canary-1.md`; `connectivity-membership-startup-4v1b.md`. | QA o validación pendiente | antes de RC · precompromiso y refresh implementados en 4V.1B; QA física pendiente · alta | conectividad + Ranking + autoenvío + header | P0/P1 si una simulación se trata como autoridad · tarea QA remota | Observar que no existe falso `Desconectado`; probar click/teclado y red real; SHA esperado coincide; cooldown no se salta; un solo retry; controles convergen tras health 204. | documentación + implementación 4V.1B |
| PR-009 MAME y pack v2 reales | Verificar flags, `-listxml`, BGFX/artwork, practice sin plugin, competition con staging/adopción y cierre real. | `shared-mame-runtime-1.md`, flags pendientes; `space-invaders-pack-v2-real-1.md`, validación MAME; `mame-pack-plugin-loading-2.md`. | QA o validación pendiente | antes de RC · pendiente · alta | runtime MAME, pack v2, plugin y cola scoped | P0 competitivo si se “corrige” sin pack real · tarea QA Space Invaders | Args reales correctos por modo; una captura adoptada al scope; práctica no captura; fallos conservan run/pending. | documentación |
| PR-010 Decisión sobre `file://` | Auditor externo debe decidir si aceptar residual o migrar documento/assets a protocolo allowlisted. | `electron-custom-protocol-backlog-1.md`, “Decisión pendiente”; risk register, `Documento Electron en file://`. | Pendiente técnico documentado | antes de RC · pendiente de auditoría · alta | seguridad Electron, CSP y assets | P0/P1 si se introduce protocolo parcial · tarea de auditoría separada | Decisión firmada; si se migra, traversal/symlink/MIME/CSP/cache/navegación probados sin abrir red. | documentación |
| PR-011 Selector de Biblioteca: continuidad y espaciado | La biblioteca izquierda conserva su `scrollTop`; solo un cambio real de detalle reinicia el panel derecho. La cabecera y los controles forman una secuencia compacta sin wrapper vacío. | Petición del usuario recuperada de la conversación; `library-geometry-account-polish-4v2-4.md`. Externa posterior a 4V.1B. | Petición explícita implementada | antes de RC · implementado en 4V.2; observado en BrowserWindow fixture · alta | 3B.1; scroll regional, cabecera y controles de biblioteca | Mitigado preservando la región scrolleable y separando la identidad del detalle; agrupado con PR-002 | Selección conserva scroll izquierdo y reinicia solo detalle nuevo; snapshots same-pack/stale no mueven paneles; gap efectivo `6 px`; filtros/vistas usan clamp natural. Queda QA con biblioteca real. | conversación + documentación + implementación 4V.2 |
| PR-012 Favorito y `Pack listo` en el hero | Quitar la estrella junto al título sin eliminar favoritos de biblioteca. Situar favorito y `Pack listo` abajo a la derecha del hero con corazón/check: badges con espacio, círculos elegantes sin él; ocultar corazón si no es favorito. | Fuente: petición del usuario recuperada de la conversación. Externa posterior a 4V.1B. | Petición explícita recuperada | antes de RC · reservada para 4V.3 · alta | 3B.2/3B.3; hero, assets y resumen de producto | Alto si duplica el badge principal o rompe fallback responsive · tarea hero 4V.3 | Una sola indicación de favorito; `Pack listo` deriva del estado canónico; composición responsive probada; sin corazón cuando no es favorito y sin cambiar persistencia de favoritos. | conversación |
| PR-013 Presentación de `Olvidar cuenta` | Control `30 × 30 px` con radio compartido y estados hover/foco/active azules; semántica destructiva expresada por nombre y confirmación, no por un cuadrado rojo. | Petición del usuario recuperada de la conversación; `library-geometry-account-polish-4v2-4.md`. Externa posterior a 4V.1B. | Petición explícita implementada | antes de RC · implementado en 4V.4; observado en BrowserWindow fixture claro/oscuro · alta | 3B.1/3B.3; menú de cuenta, diálogo y foco | Mitigado: tamaño fijo, tokens compartidos, confirmación cancel-first y servicio destructivo existente | Hover/foco azules y redondeados; nombre accesible; teclado, Cancelar y foco restaurado observados; confirmación delega en `removeKnownAccount` sin tocar colas/puntuaciones. | conversación + documentación + implementación 4V.4 |

### Dentro de Release Candidate

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RC-001 Pulido de drawers y diálogos | Refinar densidad y composición sin cambiar backdrop, focus, Escape, scroll interno ni primitivas semánticas. | `launcher-visual-foundation-1.md`, “Pendiente”; blueprint, avance overlay/dialog; inventario 3B.3. | Pendiente técnico documentado | dentro de RC · pendiente · alta | 3B.1 + 3B.3; Actividad, Avanzado y app-dialog | Alto si se añaden CSS aislados · tarea drawers/dialogs | Reutilizar tokens/primitivas; foco devuelto; teclado/scroll; temas y tamaños físicos; sin flujo nuevo. | documentación |
| RC-002 Resumen posterior a MAME | Tras cerrar, explicar intentos detectados, mejor score, enviados/pending/failed o ausencia de captura. | `launcher-gui-0.md`, estados K/L y “Flujo de juego”; `space-invaders-pack-v2-real-1.md` solo documenta resumen de args. | Parcialmente resuelto | dentro de RC · parcial/requiere contraste · media | cola scoped + 3B.3; resultado de ejecución y Actividad | Alto si se inventa una segunda cola · tarea resumen post-run | Derivado del resultado canónico; no elige “mejor” para subir; explica seguridad local; cero eventos tiene salida clara. | documentación |
| RC-003 Footer, versión y actualización veraces | Evitar `Launcher actualizado`/`v1.0.0` estáticos si no proceden de una autoridad real; separar versión de updater futuro. | `icon-visual-polish-2.md`, “Aplicado”; blueprint menciona footer; no hay contrato documental posterior de autoridad de versión. | Parcialmente resuelto | dentro de RC · parcial/requiere contraste · media | shell/footer + versión empaquetada | P1 de estado falso si se maquilla copy · tarea footer/version | Versión desde autoridad empaquetada; “actualizado” solo con comprobación real o copy neutra; sin implementar updater incidentalmente. | documentación |
| RC-004 Loader HSL de doce frames | Loader transparente: doce posiciones, once puntos y una invisible; cabeza grande, cola decreciente, giro horario y arrastre visual. | Petición del usuario recuperada E. No aparece en ningún archivo actual de `local/docs`. | Petición explícita recuperada | dentro de RC · pendiente · alta | 3B.2; overlay de startup y assets de marca | P1 si reemplaza readiness o ignora reduced-motion · tarea branding/loader | Asset/animación fiel; transparencia; movimiento horario; reduced-motion; no decide cuándo termina startup. | conversación |
| RC-005 QA visual y accesibilidad física | Temas, 100/125/150 %, ventanas reales, teclado, lector de pantalla, contraste y reduced-motion. | `launcher-product-state-presentation-3b3.md`, verificación; inventario 3B.3; varios documentos de biblioteca piden tamaños reales. | QA o validación pendiente | dentro de RC · pendiente · alta | 3B.1–3B.3; toda la shell | Alto si se sustituye por tests estáticos · tarea QA visual física | Matriz real con evidencia y defectos priorizados; no afirmar WCAG total; P0/P1 corregidos en tareas acotadas. | documentación |
| RC-006 Lifecycle empaquetado y segunda instancia | Probar doble click, suspend, shutdown con red lenta, drain y cierre bajo proveedor colgado en binarios reales. | `single-instance-policy-1.md`; estabilización de sesiones, “Shutdown”; risk register. | QA o validación pendiente | dentro de RC · pendiente · alta | main lifecycle, single instance, sesión y autoenvío | P0/P1 si se prueba con dos coordinadores no reales · tarea QA plataforma | Secundaria enfoca primaria; no duplica coordinadores; cierre conserva pending y libera/expira locks según contrato. | documentación |
| RC-007 Logging normal frente a verbose | Comparar manualmente los flags de Chromium y el warning DNS sin usar su texto como señal. | `electron-logging-policy-1.md`, último párrafo. | QA o validación pendiente | dentro de RC · pendiente/opcional · alta | main Electron y diagnóstico | Bajo; no mezclar con conectividad · checklist QA plataforma | Normal no oculta errores propios; verbose es opt-in; DnsConfig no cambia estado ni se copia como diagnóstico sensible. | documentación |
| RC-008 Ubicación visual de `Ver temporada` | La acción semántica existe, pero su posición final en primera capa no está aprobada. | Inventario 3B.3, “Acción de inscripción” y “Requiere confirmación”; `season-membership-check-2.md`. | Requiere confirmación del usuario | dentro de RC · requiere confirmación · alta | 3B.3; detalle/avanzado y membership | Medio si duplica CTAs o domina el juego · agrupar con polish de detalle | Usuario confirma superficie; URL same-origin; no cambia membership ni abre cuando no hay acción segura. | documentación |
| RC-009 Pulido restante de copy y composición | Solo corregir problemas concretos aún reproducibles; no abrir un “pulido visual completo”. | Inventario 3B.3, copy/estética futura; `launcher-product-state-presentation-3b3.md`, extensión. | Requiere confirmación del usuario | dentro de RC · requiere confirmación · media | 3B.3; regiones afectadas por cada caso | Alto si se convierte en refactor general · tickets por región | Cada cambio parte de un defecto confirmado, reutiliza modelo/primitiva/token y tiene criterio visual específico. | documentación |

### Después de la primera competición

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PC-001 Watcher de biblioteca | Vigilar la raíz con debounce e IPC, disparando solo reescaneo seguro. | `pack-distribution-mvp-1.md`, “Configuración MVP”; `pack-import-mvp-1.md`, “Queda fuera”; Space Invaders, “Pendiente”. | Pendiente técnico documentado | después de primera competición · pendiente · alta | raíz/selección 3A-3B.1 | P0 si borra/mueve o produce tormentas · tarea watcher | Debounce probado al copiar/descomprimir; un escaneo; selección estable; nunca modifica packs. | documentación |
| PC-002 Manifest e integridad de packs | Definir manifest, checksums, versión y eventualmente firma sin convertir metadata en autoridad competitiva. | `pack-contract-2.md`, separación; `shared-mame-runtime-blueprint-1.md`; Space Invaders, “Pendiente”. | Pendiente técnico documentado | después de primera competición · pendiente · alta | contrato pack v2/importador | P0 si se valida parcialmente como seguridad · tarea integridad | Esquema/versionado, cobertura de archivos, fallo atómico de import/update y política de firma explícita. | documentación |
| PC-003 Hardening competitivo | Decidir y validar TAB/DIPs/save states/rewind/pause, plugins auxiliares y adapters firmados/checksummed. | `mame-pack-plugin-loading-2.md`, límites; Space Invaders, “cfg y DIPs” y “Pendiente”; distribución MVP. | Pendiente técnico documentado | después de primera competición · pendiente · alta | MAME/plugin/pack por juego | P0 si reglas genéricas rompen juegos · tareas por amenaza/juego | Modelo de amenaza aprobado; configuración reproducible; práctica separada; evidencia real por juego. | documentación |
| PC-004 Retirada de legacy | Eliminar v1, MAME pack-local, `sync-plugin`, locations y dev bridge solo al cumplir sus condiciones. | `legacy-deprecation-plan.md`, matriz completa. | Pendiente técnico documentado | largo plazo · pendiente condicionado · alta | otra: migraciones/runtime/catálogo | P0 de compatibilidad si se hace por limpieza local · programa de deprecación | Cada condición de reemplazo demostrada, migración/telemetría y rollback; ninguna cola o pack perdido. | documentación |
| PC-005 Instalador y runtime MAME gestionado | Instalar app+MAME+plugin una vez y controlar actualización/versiones. | `shared-mame-runtime-blueprint-1.md`, secciones 3 y 11; `shared-mame-runtime-1.md`, “No implementa”. | Pendiente técnico documentado | después de beta privada · pendiente · media-alta | distribución, runtime y packaging | P0 si se mezcla con UI menor · épica separada en tareas pequeñas | Instalación reproducible, versión verificable, update/rollback y datos de usuario fuera del binario. | documentación |
| PC-006 Catálogo/descarga/instalación de packs | API web y cliente local para descubrir, verificar, instalar y actualizar packs en la raíz única. | `shared-mame-runtime-blueprint-1.md`, secciones 12/14; blueprint final; inventario 3B.3. | Pendiente técnico documentado | después de beta privada · pendiente · media | web/API + importador + integridad | P0 si se construye sobre el escáner como parche · programa catálogo | Contrato API aprobado, integridad PC-002, staging atómico, colisiones y rollback; sin MAME por pack. | documentación |

### Después de la beta privada, largo plazo u opcional

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PB-001 Vinculación de cuenta desde web | Deep link, localhost callback o device code para centralizar login/registro/recuperación. | Blueprint final, “Estado sin cuenta”; límites de account-switcher/auth. Se formula como “debería tender” y opciones a evaluar. | Propuesta de Codex no aprobada | después de beta · propuesta · media | auth web + protocolo app | P0 de sesión si se infiere aprobación · discovery separado | Requiere decisión de producto y amenaza; tokens nunca en URL/log; revocación y cancelación definidas. | documentación |
| PB-002 Ranking integrado en Electron | Consumir datos de ranking en vez de abrir la web. | `ranking-viewer-1.md`; blueprint final menciona “ranking JSON integrado pendiente”, pero el contrato vigente abre web y no existe API local estable. | Propuesta de Codex no aprobada | largo plazo · propuesta · alta | web/API Ranking + UI | Alto si se inventa contrato · discovery API/producto | Aprobación expresa, API pública estable y razón para duplicar la web; gate remota preservada. | documentación |
| PB-003 Visor PDF interno | Mostrar manual PDF dentro de la app. | `pack-distribution-mvp-1.md`, pospuesto; `pack-import-mvp-1.md`, fuera; `manual-viewer-1.md` fija apertura externa segura. | Propuesta de Codex no aprobada | opcional · propuesta · alta | seguridad renderer/manuales | P0 si se carga contenido del pack en renderer privilegiado · discovery seguridad | Aprobación UX; aislamiento/sandbox/CSP; PDFs maliciosos; fallback externo. | documentación |
| PB-004 Estados remotos, instalar/reinstalar y regalos | Estados Abierto/Acabando/Cerrado, acciones de instalación y “regalos sorpresa”. | `library-polish-status-favorites-8.md`, “Futuro documentado”; corrección 9 declara placeholder `ABIERTO`. | Propuesta de Codex no aprobada | sin determinar · propuesta · alta | catálogo remoto y library presentation | Alto si placeholders se conectan a lógica inventada · no agrupar antes de catálogo | Confirmación de producto y autoridad API; estados no falsos; instalación depende de PC-002/006. | documentación |
| PB-005 CLI sobre cola scoped activa | Adaptar CLI al scope de GUI si llega a ser necesario. | `account-pack-scoped-queue-1.md`, “CLI”: “queda para una tarea explícita posterior si hace falta”. | Propuesta de Codex no aprobada | opcional · propuesta · alta | CLI + sesiones/scopes | P0 de ownership si se improvisa · tarea solo tras aprobación | Caso de uso aprobado, selector inequívoco de cuenta/pack y locks compartidos; no tocar legacy por defecto. | documentación |
| PB-006 Nuevas vistas, navegación o branding adicional | No hay especificación suficiente para ampliar navegación, vistas o personalización más allá del loader recuperado. | Inventario 3B.3, “Requiere confirmación”; 3B.3 fuera de alcance. | Requiere confirmación del usuario | sin determinar · requiere confirmación · alta | 3B.1/3B.3/assets | Alto si se transforma intención genérica en requisito · discovery por propuesta | Mockup/flujo aprobado y alcance acotado; reutiliza regiones/modelos/tokens; no reabre autoridades. | documentación |

### Contratos y soluciones que no deben convertirse en backlog

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOL-001 Bases 3A–3B.3 | Revisión monotónica, renderer regional, tema/readiness/assets y presentación semántica son autoridades vigentes. | `launcher-state-authority-3a.md`; 3B.2; 3B.3; inventario 3B.3. Julio 2026. | Solucionado documentalmente | antes de RC · solucionado · alta | 3A/3B.1/3B.2/3B.3 | P0 si una tarea visual las reabre · guardrail transversal | Futuras tareas consumen gates/modelos/regiones; cualquier regresión necesita reproducción, no una nueva arquitectura. | documentación |
| SOL-002 Continuidad normal de sesión | El usuario no reloguea por caducidad normal si refresh sigue válido; revoke, mismatch o corrupción sí pueden exigir login. | Conversación F; `persistent-account-sessions-1.md`; estabilización canónica. | Contrato documentado vigente | antes de RC · solucionado en documentación/código declarado · alta | sesiones canónicas | P0 si se promete sesión irrevocable · separar de PR-005 | Refresh silencioso bajo política; fallos temporales conservan sesión; rechazo concluyente exige login. | conversación + documentación |
| SOL-003 Cola segura y resultados | Pending no se pierde por red/auth; outcome, cooldown y multi-cuenta son canónicos; background es silencioso. | `submission-outcome-policy-1.md`; `pending-auto-submit-reliability-2.md`; `auto-sync-queue-1.md`. | Solucionado documentalmente | antes de RC · solucionado · alta | autoenvío/cola scoped | P0 si se crea flujo paralelo · guardrail | Todo envío usa coordinador/locks/outcomes; mensajes explican seguridad local; no hay borrado por fallo temporal. | documentación |
| SOL-004 Raíz, selección e importación seguras | Clasificación de raíz, selección por instancia, empty states e import ZIP/carpeta atómica están documentados. | `library-root-contract-1.md`; `library-selection-state-robustness-3.md`; `pack-import-mvp-1.md`. | Solucionado documentalmente | antes de RC · solucionado, salvo PR-004 · alta | biblioteca/pack v2 | P0 si se duplican clasificadores · guardrail | Una única clasificación; cancel/rechazo no escriben; importación temporal+rename; selección real o null. | documentación |
| SOL-005 Gate y estabilidad de Ranking | Health confirmado, capability por week, cache de proceso sin TTL y rechazo stale son contrato vigente. | `remote-availability-gate-1.md`; `ranking-capability-stability-1.md`; `ranking-session-verification-1.md`; conectividad reliability. | Solucionado documentalmente | antes de RC · solucionado, salvo feedback PR-001 · alta | conectividad/Ranking | P0 si el overlay toma autoridad · guardrail | PR-001 solo presenta la acción; no revalida TTL, no fabrica available y main mantiene same-origin. | documentación |
| SOL-006 Menú de cuenta final | Header por siglas, emails visibles en menú, olvidar por fila y login efímero son la cadena vigente. | account menu polish→behavior→compact→layout; 3B.3 login; `ranking-interactive-feedback-account-notice-4v1.md`; `account-membership-connectivity-presentation-4v1a.md`. | Solucionado documentalmente | antes de RC · aviso no accionable corregido; QA visual con dos cuentas pendiente · alta | 3B.1/3B.3 + cuentas | Alto si se recupera copy/botón obsoleto · guardrail | Mantener foco y apertura limpia; una sesión local autorrecuperable no crea aviso, pero revoke/login requerido sí; validar con dos cuentas reales. | documentación + implementación 4V.1A |
| SOL-007 Pack v2 y runtime competitivo | Runtime compartido, preparación aislada, adapter copiado, staging por run e import local sustituyen el bloqueo v2 inicial. | `pack-contract-2.md`; loading 1→2; shared runtime; Space Invaders; import MVP. | Solucionado documentalmente | antes de RC · solucionado, pendiente QA PR-009 · alta | MAME/plugin/pack/cola | P0 si se vuelve a pack-local o `userData/events` · guardrail | V2 usa run aislado y scope; v1 sigue legacy hasta PC-004; práctica nunca activa captura. | documentación |
| SOL-008 Iconos, tipografía y assets base | SVG locales, máscaras, fallbacks, Manrope/Sora, hero/logo y assets convencionales tienen contratos posteriores. | icon system/tint/color; typography/light theme; hero preload; metadata assets; 3B.2. | Solucionado documentalmente | dentro de RC · solucionado · alta | 3B.2/3B.3; assets visuales | Medio si se reemplazan por URLs/inline o se confunde loader · guardrail | Assets locales, fallback definitivo, autoridad generacional y ningún recurso remoto en renderer. | documentación |

### Decisiones obsoletas o sustituidas

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OBS-001 Render completo de `#app` | El pendiente de refactor incremental del audit 12 fue sustituido por montaje único y renderer regional 3B.1. | `render-state-stability-audit-12.md`, Renderer/Pendientes; 3B.3, integración 3B.1. | Obsoleto o sustituido | antes de RC · obsoleto · alta | 3B.1 | P0 si se “termina” el refactor antiguo · no tarea | Solo reabrir ante regresión reproducible del renderer regional. | documentación |
| OBS-002 Varias ubicaciones como producto | `locations.json` y abrir pack externo dejaron de ser la experiencia principal; la raíz única manda. | `pack-library-locations-1.md`, nota histórica; `pack-directory-model-1.md`; root contract. | Obsoleto o sustituido | antes de RC · obsoleto/legacy · alta | biblioteca | Alto si se reintroduce UI paralela · PC-004 al retirar | Mantener lectura legacy no destructiva hasta cumplir deprecación; no presentarlo como feature nueva. | documentación |
| OBS-003 `Subir pendientes` como flujo ordinario | Documentos antiguos lo muestran en drawer; la fiabilidad posterior declara retirada de la acción ordinaria y un coordinador único. | `activity-details-1.md`/`auto-sync-queue-1.md` frente a `pending-auto-submit-reliability-2.md`, párrafo final. Julio 2023 posterior. | Obsoleto o sustituido | antes de RC · obsoleto · alta | autoenvío/Actividad | P0 si crea dos coordinadores · no tarea | Recuperación usa restore/estado canónico; force solo desarrollo; cualquier CTA manual requiere nueva decisión explícita. | documentación |
| OBS-004 TTL de Ranking | TTL 5/2 min del documento web fue eliminado por estabilidad de sesión de proceso. | `web-ranking-capabilities-1.md`, último párrafo; `ranking-capability-stability-1.md` y session verification posteriores. | Obsoleto o sustituido | antes de RC · obsoleto · alta | Ranking | P0/P1 de flicker si se restaura · no tarea | Available/unavailable concluyentes por proceso; solo cambios semánticos o unknown reintentan. | documentación |
| OBS-005 Botón global `Cerrar sesión` | El blueprint y polish inicial lo incluían; compact polish lo retiró y olvidar cuenta activa asumió el cierre local. | blueprint/header; `account-menu-polish-1.md`; compact polish 3 y layout 4 posteriores. | Obsoleto o sustituido | antes de RC · obsoleto · alta | menú cuenta | Medio si duplica acciones · no tarea | Una acción por fila, semántica segura y sin borrar puntuaciones. | documentación |
| OBS-006 Competición v2 bloqueada por cargador inexistente | Loading-1 documentó el bloqueo; Loading-2 implementó la preparación aislada y sustituyó ese estado histórico. | `mame-pack-plugin-loading-1.md`, “Resultado/Siguiente tarea”; `mame-pack-plugin-loading-2.md`; pack contract actual. | Obsoleto o sustituido | antes de RC · obsoleto · alta | pack v2/plugin | P0 si se usa como blocker actual genérico · no tarea | Solo bloquear por readiness actual concreta; PR-009 valida el flujo real. | documentación |

### Contradicciones documentales visibles

| ID y título | Descripción | Fuente exacta y posición | Clasificación | Fase · estado · confianza | Dependencia y región | Riesgo de parche · agrupación | Criterio mínimo futuro | Procedencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CON-001 Geometría de ventana/sidebar/tile | Se documentan mínimo 920→1180, sidebar 280–520→340–600, otros docs 320–600 y tile 128→122. La cadena más tardía favorece 1180x620, 340–600/440 y 122, pero el runtime no se auditó. | shell detail polish→hotfix (30 jun); library refinement→micropolish→correcciones (28–29 jun); inventario 3B.3 vuelve a citar 920. | Requiere contraste técnico posterior | antes de RC · requiere contraste · alta sobre contradicción | 3B.1; window/sidebar/grid | Alto si se elige un número por conveniencia · agrupar PR-002 | Contrastar constantes/CSS/tests una vez; declarar valores canónicos y probar mínimo/default/máximo sin inutilizar detalle. | documentación |
| CON-002 Altura máxima del hero | Audit/preload citan 220 px; shell polish/hotfix posterior cita 340/330 px. | `render-state-stability-audit-12.md`; `hero-logo-list-preload-13.md`; `shell-detail-polish-2.md` y hotfix 3. | Requiere contraste técnico posterior | dentro de RC · requiere contraste · alta | 3B.2; detalle/hero | Medio si se añade otra override · geometría detalle | Identificar valor runtime vigente, conservar ratio/crop/fallback y documentar una sola autoridad. | documentación |
| CON-003 Punto o SVG para conectividad | El estado usa punto+texto sin SVG; el icon system permite un SVG local cuando representa la acción independiente de refresh. 3B.3 exige semántica sin convertir el asset en autoridad. | `icon-visual-polish-2.md`; `icon-system-1.md`; 3B.3; `account-membership-connectivity-presentation-4v1a.md`; `connectivity-membership-startup-4v1b.md`. | Solucionado documentalmente | dentro de RC · distinción estado/acción implementada en 4V.1B; QA visual pendiente · alta | 3B.3; header/status primitives | Bajo; no fusionar botón y estado ni duplicar la gate técnica · guardrail | Precompromiso oculto; después texto `Conectado`/`Desconectado` y punto CSS; SVG `refresh` solo en botón separado; validar contraste, foco y primer frame. | documentación + implementación 4V.1A/4V.1B |

## 5. Backlog pre-release

4V.1, 4V.1A y 4V.1B están implementadas; PR-001 permanece en QA visual y
PR-006/PR-008 en QA real. La siguiente prioridad documental, sin equivaler a
estimación, es:

1. PR-002, PR-011 y CON-001, como una sola 4V.2 de geometría, continuidad de
   biblioteca, cuatro Iconos y espaciado de cabecera/selector.
2. PR-012, composición de favorito y `Pack listo` en hero, reservada para 4V.3.
3. PR-013, presentación coherente de `Olvidar cuenta`, reservada para 4V.4.
4. PR-003, readiness del primer viewport, sobre la autoridad 3B.2 existente.
5. PR-004, flujo único de ubicación, preservando raíz y selección separadas.
6. PR-005 y PR-007, validación Auth/almacenamiento seguro; son gates de release,
   no trabajo visual.
7. PR-008, QA física de primer frame, refresh, deployment, conectividad y
   cooldowns.
8. PR-009 y PR-006, recorrido MAME/Space Invaders real y estado inicial.
9. PR-010, decisión de auditoría sobre `file://`; no debe colarse dentro de una
   tarea de assets.

## 6. Backlog de Release Candidate

- RC-001: drawers y diálogos, una vez cerradas las interacciones críticas.
- RC-002: resumen posterior a MAME basado en resultados existentes.
- RC-003: footer y versión veraces, sin fingir un updater.
- RC-004: loader recuperado, estrictamente presentación de 3B.2.
- RC-005: QA visual/accesibilidad física después de los cambios anteriores.
- RC-006 y RC-007: QA de lifecycle empaquetado y logging.
- RC-008 y RC-009 solo deben convertirse en tarea tras confirmación del
  usuario y un defecto o ubicación concretos.

## 7. Backlog posterior a la primera competición

Después de la primera competición: PC-001 watcher, PC-002 integridad y PC-003
hardening. Sus dependencias hacen inseguro adelantarlos como microparches de UI.

## 8. Backlog posterior a la beta

Después de la beta privada o a largo plazo: PC-004 retirada legacy, PC-005
instalador/runtime gestionado y PC-006 catálogo. PB-001–PB-006 permanecen como
propuestas o decisiones sin confirmar, no como backlog comprometido.

## 9. Propuestas no aprobadas

PB-001 a PB-005 son ideas o direcciones razonables, pero la documentación no
prueba aprobación suficiente: vinculación web, ranking integrado, visor PDF,
estados/acciones remotas y CLI scoped. PB-006 necesita una especificación del
usuario. Ninguna debe aparecer como “pendiente comprometido” en una siguiente
tarea por el mero hecho de figurar en un blueprint o `Fuera de alcance`.

PR-011, PR-012 y PR-013 no son propuestas de Codex: proceden de peticiones
explícitas recuperadas y están comprometidas para 4V.2, 4V.3 y 4V.4
respectivamente. Registrarlas no autoriza implementarlas dentro de 4V.1B.

## 10. Elementos solucionados que no deben reabrirse

SOL-001 a SOL-008 forman los guardrails: autoridades 3A–3B.3, continuidad de
sesión, cola/outcomes, raíz/selección/import, gate de Ranking, menú de cuenta,
pack v2/runtime y sistema local de assets. OBS-001 a OBS-006 son contratos
históricos ya sustituidos. Solo una regresión reproducible permite reabrirlos.

4V.1B amplía esos guardrails sin sustituirlos: precompromiso de conectividad
oculto, refresh explícito separado, coordinador inicial de membership y gate
`Jugar`. Su implementación automatizada no cierra PR-006 ni PR-008 sin QA real.

## 11. Contradicciones documentales

- CON-001: geometría; el orden histórico no coincide con algunos resúmenes
  posteriores.
- CON-002: hero 220 frente a 330 px.
- CON-003 queda resuelta por la distinción de 4V.1B: punto CSS para estado y SVG
  `refresh` únicamente para el botón de acción separado.
- OBS-003, OBS-004 y OBS-005 parecen contradicciones si se leen documentos
  aislados, pero su cronología permite clasificarlas como sustituciones claras.
- `pack-distribution-mvp-1.md` conserva “importación ZIP segura” en una lista
  pospuesta aunque el mismo documento y `pack-import-mvp-1.md` declaran la
  importación implementada; se considera texto histórico superado, no backlog.

## 12. Requisitos que necesitan contraste técnico

CON-001 y CON-002 necesitan una tarea posterior de contraste acotado con
constantes, CSS y tests. CON-003 ya tiene contrato e implementación, pero su QA
visual física continúa pendiente. PR-002, PR-011, RC-002 y RC-003 también
requieren contraste de su estado real antes de implementar.

La referencia `docs/launcher-api.md` aparece en el blueprint, pero está fuera de
la fuente obligatoria `local/docs` y no se trató como documento perdido. Sus
contratos no se usan para declarar backlog en esta reconstrucción.

## 13. Requisitos que necesitan confirmación del usuario

- RC-008: posición final de `Ver temporada`.
- RC-009: qué defectos concretos forman el siguiente polish de copy/composición.
- PB-006: nuevas vistas, navegación, branding o personalización más allá del
  loader recuperado.
- Las propuestas PB-001–PB-005 necesitan aprobación antes de promoción a
  contrato, aunque no se repitan aquí como clasificación 11.

## 14. Orden recomendado de las siguientes tareas

El orden evita una tarea genérica de “pulido completo”:

1. **4V.1/4V.1A/4V.1B — Implementadas, QA real residual.** Ranking explícito,
   cuenta silenciosa, conectividad manual e inicialización de membership; no se
   cierran PR-001/PR-006/PR-008 sin sus recorridos físicos.
2. **4V.2 — Biblioteca.** Contrastar CON-001 y resolver conjuntamente PR-002 y
   PR-011: cuatro Iconos, continuidad de `scrollTop` izquierdo y espaciado entre
   cabecera, ubicación y filtros.
3. **4V.3 — Hero.** PR-012: favorito y `Pack listo` adaptables en la esquina
   inferior derecha, sin tocar la persistencia de favoritos.
4. **4V.4 — Cuenta.** PR-013: hover/foco de `Olvidar cuenta`, sin reabrir
   sesiones ni el aviso no accionable.
5. **4V.5 — Readiness de imágenes del primer viewport.** Ampliar 3B.2 por vista
   y viewport sin esperar assets no visibles.
6. **4V.6 — Ubicación y recuperación unificadas.** PR-004, diálogos de raíz y
   `defaultPath`; no mezclar con importador ni catálogo.
7. **4V.7 — QA Auth y secure storage.** PR-005/PR-007 por plataforma y staging;
   principalmente validación, con fixes separados si aparece un fallo.
8. **4V.8 — QA remota y deployment.** PR-008, con primer frame, refresh,
   Ethernet, cooldown y SHA.
9. **4V.9 — QA Space Invaders v2 real.** PR-009/PR-006: membership, MAME,
   captura, estado inicial y salida; cualquier fix se deriva como tarea acotada.
10. **4V.10 — Drawers y diálogos.** RC-001; no incluye ubicación ni Ranking.
11. **4V.11 — Resumen posterior a MAME.** RC-002, apoyado en estado/cola
    canónicos.
12. **4V.12 — Footer y versión.** RC-003; no implementar updater.
13. **4V.13 — Branding y loader.** RC-004 sobre el overlay 3B.2, con
    reduced-motion.
14. **4V.14 — QA visual física de RC.** RC-005–RC-007 tras cerrar los cambios
    anteriores.

Watcher, integridad, hardening, legacy, instalador y catálogo permanecen en su
fase posterior. Esta secuencia no compromete una estimación temporal.

## 15. Apéndice de cobertura archivo por archivo

Claves: `Pend.` indica que contiene al menos un pendiente/candidato relevante;
`Sust.` que contiene un contrato después sustituido; `Hist.` que se necesitó
historial o continuidad para clasificarlo. Los IDs `SOL`/`OBS` también cuentan
como elementos derivados aunque no sean backlog abierto.

| # | Archivo | Leído completo | Pend. relevante | Sust. | Hist. | IDs derivados | Observaciones |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `account-menu-behavior-2.md` | sí | no | sí | no | SOL-006, OBS-005 | Behavior intermedio; compact/layout fijan la presentación final. |
| 2 | `account-menu-compact-polish-3.md` | sí | no | sí | sí | SOL-006, OBS-005 | Retira logout global; layout 4 corrige emails/espaciado. |
| 3 | `account-menu-layout-correction-4.md` | sí | no | no | no | SOL-006 | Último contrato específico del layout de cuenta. |
| 4 | `account-menu-polish-1.md` | sí | no | sí | sí | SOL-006, OBS-005 | Base visual sustituida parcialmente por behavior/compact/layout. |
| 5 | `account-pack-scoped-queue-1.md` | sí | sí | no | no | SOL-003, PB-005 | GUI scoped vigente; adaptación CLI queda condicionada a necesidad. |
| 6 | `account-switcher-gui-1.md` | sí | sí | sí | sí | PB-001, SOL-006 | Modelo de una sesión activa superado por GUI-2; propuestas web no aprobadas. |
| 7 | `account-switcher-gui-2.md` | sí | sí | no | no | SOL-002, SOL-006, PB-001 | Sesiones por cuenta vigentes; deep link/device code son límites, no compromiso. |
| 8 | `activity-details-1.md` | sí | no | sí | sí | SOL-003, OBS-003 | La primera capa fue compactada; el submit manual ordinario fue retirado después. |
| 9 | `auto-sync-queue-1.md` | sí | no | sí | sí | SOL-003, OBS-003 | Contrato base ampliado por fiabilidad multicuenta y outcomes. |
| 10 | `canonical-account-sessions-1.md` | sí | no | no | no | SOL-002, PR-005 | Resumen vigente que remite a estabilización detallada. |
| 11 | `canonical-account-sessions-stabilization-2.md` | sí | sí | no | no | SOL-002, PR-005, PR-007, RC-006 | Protocolo de staging y riesgos físicos expresamente no ejecutados. |
| 12 | `connectivity-final-risk-register-3.md` | sí | sí | no | no | PR-005, PR-007, PR-008, PR-010, RC-006 | Registro principal de riesgos remotos/security aún operativos. |
| 13 | `connectivity-ranking-reliability-2.md` | sí | sí | no | no | SOL-005, PR-008 | Código declarado cerrado; deploy y Ethernet siguen pendientes. |
| 14 | `connectivity-state-1.md` | sí | no | no | no | SOL-005 | Autoridad vigente de reachability; no convierte QA física en requisito nuevo. |
| 15 | `deployment-fingerprint-1.md` | sí | sí | no | no | PR-008 | Deploy con SHA esperado no verificado. |
| 16 | `diagnostic-logs-1.md` | sí | no | no | no | SOL-001, SOL-002, SOL-003 | Contrato sanitizado; no propone reparación automática. |
| 17 | `electron-csp-policy-1.md` | sí | no | no | no | SOL-001, PR-010 | CSP vigente; excepción de estilos solo contextualiza el audit de protocolo. |
| 18 | `electron-custom-protocol-backlog-1.md` | sí | sí | no | no | PR-010 | Backlog explícito condicionado a decisión de auditor externo. |
| 19 | `electron-logging-policy-1.md` | sí | sí | no | no | RC-007 | Comparación normal/verbose manual pendiente. |
| 20 | `electron-renderer-security-boundary-1.md` | sí | no | no | no | SOL-001 | Guardrail de renderer/preload/main. |
| 21 | `favorites-scoped-2.md` | sí | no | no | no | SOL-004 | Favoritos por cuenta solucionados; fuera de alcance no se eleva. |
| 22 | `game-detail-polish-1.md` | sí | no | no | no | SOL-001, SOL-008 | Contrato de detalle; 3B.3 sustituye la política de múltiples chips. |
| 23 | `global-hsl-origin-1.md` | sí | no | no | no | SOL-005 | Origen global y configuración remota vigentes. |
| 24 | `hero-logo-list-preload-13.md` | sí | sí | sí | sí | PR-003, CON-002, SOL-008 | Precarga de detalle parcial; altura entra en contradicción posterior. |
| 25 | `icon-color-polish-2.md` | sí | no | no | no | SOL-008 | Excepciones visuales localizadas, no backlog. |
| 26 | `icon-system-1.md` | sí | no | no | sí | SOL-008, CON-003 | Contrato local de iconos; lista de SVG no implica que falten actualmente. |
| 27 | `icon-tint-system-fix-1.md` | sí | no | no | no | SOL-008 | Solución de tintado vigente. |
| 28 | `icon-visual-polish-2.md` | sí | sí | sí | sí | RC-003, CON-003 | Footer y punto de conectividad requieren continuidad/contraste. |
| 29 | `launcher-auth-gui-1.md` | sí | sí | sí | no | SOL-002, PB-001 | Login inicial superado por sesiones canónicas; flujos web siguen propuestas. |
| 30 | `launcher-final-ux-blueprint-1.md` | sí | sí | sí | sí | PR-001–004, RC-001–004, PC-001/005/006, PB-001/002/006 | Documento agregador; sus avances posteriores evitan tratar todo como pendiente. |
| 31 | `launcher-gui-0.md` | sí | sí | sí | no | RC-002, PB-001 | Fuente explícita del resumen post-MAME; gran parte del MVP quedó sustituida. |
| 32 | `launcher-gui-1.md` | sí | no | sí | no | OBS-002, OBS-006, SOL-003/004/007 | Crónica acumulativa del prototipo, no backlog actual por sí sola. |
| 33 | `launcher-pack-open-1.md` | sí | no | sí | no | OBS-002 | Apertura manual histórica sustituida como experiencia principal por raíz única. |
| 34 | `launcher-pack-remember-1.md` | sí | no | sí | no | OBS-002, SOL-004 | `recent.json` quedó como migración de compatibilidad de selección. |
| 35 | `launcher-product-state-presentation-3b3.md` | sí | sí | no | no | SOL-001, PR-006, RC-005/008/009 | Base semántica cerrada; QA física y decisiones visuales quedan explícitas. |
| 36 | `launcher-shell-bugfix-3.md` | sí | no | sí | no | SOL-001, RC-001 | Drawers/scroll corregidos; visual foundation modifica superficie, no contratos. |
| 37 | `launcher-shell-layout-2.md` | sí | no | sí | sí | SOL-001, RC-001, OBS-003 | Mínimo 1200 y primera capa antigua sustituidos por polish/hotfix/3B.1. |
| 38 | `launcher-startup-theme-assets-3b2.md` | sí | sí | no | no | SOL-001, SOL-008, PR-003, PR-006, RC-004/005 | Autoridad vigente; documenta que solo detalle inicial bloquea. |
| 39 | `launcher-state-authority-3a.md` | sí | no | no | no | SOL-001 | Gate de snapshots vigente. |
| 40 | `launcher-submission-recovery-1.md` | sí | no | sí | no | SOL-003 | Cola efectiva inicial sustituida por scope cuenta+pack; recuperación sigue vigente. |
| 41 | `launcher-ux-revamp-1.md` | sí | no | sí | sí | SOL-001, SOL-006, OBS-005 | Resumen acumulativo; compact polish prevalece en cuenta. |
| 42 | `launcher-ux-visual-polish-4.md` | sí | no | no | no | SOL-001, RC-001 | Feedback/reescaneo y semántica visual declarados aplicados. |
| 43 | `launcher-visual-foundation-1.md` | sí | sí | sí | sí | RC-001, RC-009, SOL-008, CON-001 | Game detail se resolvió; drawers y polish posterior permanecen acotados. |
| 44 | `launcher-visual-functional-inventory-3b3.md` | sí | sí | no | no | SOL-001, RC-005/008/009, PB-006 | Inventario previo útil, pero 4V.0 reclasifica sus genéricos. |
| 45 | `legacy-deprecation-plan.md` | sí | sí | no | no | PC-004 | Condiciones explícitas; no hay fecha ni eliminación autorizada. |
| 46 | `library-breakpoint-polish-5.md` | sí | sí | sí | sí | PR-002, RC-005, CON-001 | Declara 320/600 y 122 tras continuidad; shell hotfix posterior difiere en mínimo. |
| 47 | `library-cards-1.md` | sí | sí | sí | sí | PR-002, CON-001, SOL-004 | 360 mínimo/128 quedan superados; filtro favoritos se resolvió después. |
| 48 | `library-controls-fix-sort-6.md` | sí | no | sí | sí | SOL-004, CON-001 | 122 y controles posteriores prevalecen sobre revamp inicial. |
| 49 | `library-controls-revamp-2.md` | sí | sí | sí | no | RC-001, PR-004 | “Afinar zona avanzada si se recupera” no se eleva salvo dentro de flujo confirmado. |
| 50 | `library-correction-assets-scroll-10.md` | sí | no | no | no | SOL-008, PR-003 | Último contrato de assets convencionales/scrollbar; no prueba readiness viewport. |
| 51 | `library-correction-badges-scroll-9.md` | sí | sí | no | sí | PR-002, PB-004, CON-001 | 122/4 columnas vigente documentalmente; estados remotos siguen placeholder. |
| 52 | `library-layout-refinement-3.md` | sí | sí | sí | sí | PR-002, RC-005, CON-001 | 128 y QA manual; correcciones posteriores fijan 122. |
| 53 | `library-micropolish-sort-scroll-7.md` | sí | sí | no | sí | PR-002, RC-005, CON-001 | Fuente directa de 122/2–4 columnas y QA de tamaños reales. |
| 54 | `library-polish-status-favorites-8.md` | sí | sí | no | no | PR-002, PB-004 | “Futuro documentado” se conserva como propuesta, no compromiso. |
| 55 | `library-responsive-auth-guards-4.md` | sí | sí | sí | sí | PR-002, RC-005, CON-001 | 128 histórico y QA real; breakpoint posterior lo corrige. |
| 56 | `library-root-contract-1.md` | sí | sí | no | no | SOL-004, PR-004 | Clasificador vigente; no documenta todo `defaultPath` externo. |
| 57 | `library-selection-state-robustness-3.md` | sí | no | no | no | SOL-004, PR-004 | Selección/raíz separadas y cancelación segura son guardrails. |
| 58 | `light-theme-sora-pass-1.md` | sí | no | no | no | SOL-008, RC-005 | Tema claro aplicado; QA física queda en RC-005 por fuentes posteriores. |
| 59 | `mame-pack-plugin-loading-1.md` | sí | no | sí | sí | OBS-006, SOL-007 | Bloqueo v2 sustituido por loading-2. |
| 60 | `mame-pack-plugin-loading-2.md` | sí | sí | no | no | SOL-007, PR-009, PC-003 | Implementación declarada; sandbox/firmas permanecen fuera. |
| 61 | `manual-viewer-1.md` | sí | sí | no | no | PB-003, SOL-007 | Apertura externa es contrato vigente; visor interno no aprobado. |
| 62 | `multi-account-background-submit-1.md` | sí | no | no | no | SOL-003 | Contrato multicuenta vigente. |
| 63 | `network-topology-monitor-1.md` | sí | sí | no | no | SOL-005, PR-008 | Implementación documentada; validación física viene del risk register. |
| 64 | `offline-recovery-canary-1.md` | sí | sí | no | no | PR-008, SOL-005 | Mediana física pendiente expresamente. |
| 65 | `operation-feedback-lifecycle-1.md` | sí | no | no | no | PR-001, SOL-001 | La infraestructura existe; la petición externa distingue click de batch. |
| 66 | `pack-contract-2.md` | sí | sí | sí | no | SOL-007, PC-002, OBS-006 | Capture histórico sustituido; manifest completo sigue futuro. |
| 67 | `pack-directory-missing-flow-1.md` | sí | sí | no | no | SOL-004, PR-004, RC-001 | Recuperación documentada, parte del flujo unificado pendiente. |
| 68 | `pack-directory-model-1.md` | sí | sí | sí | sí | SOL-004, PR-004, OBS-002, PC-006 | Pack activo externo y copy antiguos requieren leer selección/root posterior. |
| 69 | `pack-distribution-mvp-1.md` | sí | sí | sí | sí | SOL-007, PR-009, PC-001/002/003/005/006, PB-003 | Import ZIP aparece también pospuesto: texto superado por import MVP. |
| 70 | `pack-import-mvp-1.md` | sí | sí | no | no | SOL-004, SOL-007, PC-001/002/006, PB-003 | Importación local resuelta; catálogo/updater/visor permanecen separados. |
| 71 | `pack-library-grid-1.md` | sí | no | sí | no | SOL-004, OBS-002, PB-004 | Botones/grupos iniciales sustituidos por cards y controles posteriores. |
| 72 | `pack-library-locations-1.md` | sí | no | sí | sí | OBS-002, SOL-004 | Marcado explícitamente histórico; raíz única prevalece. |
| 73 | `pack-library-seasons-1.md` | sí | no | no | no | SOL-004 | Agrupación local sin estados remotos; no crea PB-004 por sí sola. |
| 74 | `pack-library-views-1.md` | sí | no | sí | no | SOL-004 | Favoritos “propuestos” fueron resueltos por tareas posteriores. |
| 75 | `pack-metadata-assets-1.md` | sí | no | sí | no | SOL-008, PR-003 | Assets de detalle/cards resueltos; 3B.2 sustituye autoridad de precarga. |
| 76 | `pack-readiness-1.md` | sí | no | sí | no | SOL-007, PR-006 | Futuro shared runtime/capture ya actualizado por loading-2; regla competitiva vigente. |
| 77 | `pending-auto-submit-1.md` | sí | no | sí | no | SOL-003 | Modelo activo-only sustituido por fiabilidad multicuenta. |
| 78 | `pending-auto-submit-reliability-2.md` | sí | no | no | no | SOL-003, OBS-003 | Contrato vigente y fuente de retirada del submit manual ordinario. |
| 79 | `persistent-account-sessions-1.md` | sí | sí | no | no | SOL-002, PR-005, PR-007 | Objetivo de producto vigente; panel Supabase no validado. |
| 80 | `ranking-capability-stability-1.md` | sí | no | no | sí | SOL-005, OBS-004 | Sustituye explícitamente TTL y timer. |
| 81 | `ranking-session-verification-1.md` | sí | no | no | no | SOL-005, PR-001 | Gate/caché vigentes; no prescribe feedback del click. |
| 82 | `ranking-viewer-1.md` | sí | sí | no | no | PB-002, SOL-005 | Ranking integrado es propuesta; apertura web sigue contrato. |
| 83 | `remote-availability-gate-1.md` | sí | no | no | no | SOL-005, PR-001 | Guardrail para Ranking y futuras acciones remotas. |
| 84 | `remote-request-lifecycle-1.md` | sí | no | no | no | SOL-003, SOL-005, PR-008 | Lifecycle remoto vigente; QA física se deriva de otros documentos. |
| 85 | `render-state-stability-audit-12.md` | sí | sí | sí | sí | OBS-001, PR-002, PR-003, RC-005, CON-002 | Pendiente de remount resuelto por 3B.1; QA/valores requieren continuidad. |
| 86 | `scoped-event-staging-readiness-14.md` | sí | no | sí | no | SOL-003, SOL-007, OBS-006 | “No habilita v2” fue superado por loading-2. |
| 87 | `season-membership-check-1.md` | sí | sí | sí | no | SOL-001, RC-008 | Normalización inicial sustituida por check-2; acción web sigue segura. |
| 88 | `season-membership-check-2.md` | sí | sí | no | no | SOL-001, RC-008 | Contrato vigente; posición visual de acción requiere confirmación. |
| 89 | `secure-session-storage-1.md` | sí | sí | no | no | SOL-002, PR-007 | Fallback funcional no equivale a confidencialidad. |
| 90 | `shared-mame-runtime-1.md` | sí | sí | sí | no | SOL-007, PR-009, PC-005 | Competición pendiente histórica actualizada por loading-2; flags reales siguen QA. |
| 91 | `shared-mame-runtime-blueprint-1.md` | sí | sí | sí | sí | SOL-007, PC-002/004/005/006, PB-001/004 | Blueprint mezcla destino aprobado, alternativas y roadmap; no todo es compromiso. |
| 92 | `shell-detail-hotfix-3.md` | sí | sí | no | sí | PR-002, CON-001, CON-002 | Último documento de shell específico; contradice resúmenes posteriores. |
| 93 | `shell-detail-polish-2.md` | sí | sí | sí | sí | CON-001, CON-002 | Valores intermedios sustituidos por hotfix. |
| 94 | `single-instance-policy-1.md` | sí | sí | no | no | SOL-001, RC-006 | Validación de ejecutable empaquetado pendiente. |
| 95 | `space-invaders-pack-v2-real-1.md` | sí | sí | sí | no | SOL-007, PR-006, PR-009, PC-001/002/003 | Importación pendiente fue resuelta; resto de QA/hardening sigue separado. |
| 96 | `submission-outcome-policy-1.md` | sí | no | no | no | SOL-003 | Outcome canónico vigente. |
| 97 | `templates/pack-v2/metadata.json` | sí | no | no | no | SOL-007, SOL-008 | Plantilla, sin backlog propio. |
| 98 | `templates/pack-v2/pack.json` | sí | no | no | no | SOL-007 | Plantilla del contrato v2. |
| 99 | `templates/pack-v2/README.md` | sí | no | no | no | SOL-007 | Instrucciones de distribución/importación vigentes. |
| 100 | `templates/pack-v2/scripts/adapter.lua` | sí | no | no | no | SOL-007, PC-003 | Plantilla deliberadamente incompleta por juego; no es un bug del launcher. |
| 101 | `typography-manrope-1.md` | sí | no | no | no | SOL-008 | Dirección tipográfica vigente. |
| 102 | `web-ranking-capabilities-1.md` | sí | no | sí | sí | SOL-005, OBS-004 | Contrato servidor vigente salvo TTL Electron, sustituido posteriormente. |

**Control de suma del censo original:** 102 filas, igual a los 102 archivos
fuente físicos y versionados enumerados entonces. Los documentos de continuidad
4V.0–4V.1B se citan en las actualizaciones, pero no se insertan ni renumeran en
este apéndice histórico.

## 16. Documentos eliminados o renombrados recuperados desde Git

`git log --all --diff-filter=DR -- local/docs` no devolvió eliminaciones ni
renombres. Por tanto:

- documentos eliminados relevantes recuperados: ninguno;
- documentos renombrados relevantes recuperados: ninguno;
- requisitos recuperados exclusivamente desde una versión eliminada: ninguno.

El historial sí fue necesario para ordenar documentos actuales modificados en
cadena. Fechas/commits relevantes:

- biblioteca y geometría: 27–30 de junio de 2026, desde `f9e71d8` hasta
  `1b007da`; 122 px aparece en las correcciones tardías y el hotfix de shell es
  posterior a los límites de 320 px;
- importación: `ba5db6a` y `414306d` (2 de julio) sustituyen las menciones
  antiguas de “ZIP futuro”;
- Ranking/conectividad: `8fc3086`→`85ba476` (15–17 de julio) elimina TTL y
  consolida cache de proceso/gate;
- renderer/startup/presentación: audit de junio, 3B.2 `a3b2937` y 3B.3
  `a56976f` forman la cadena vigente;
- cuenta: polish→behavior→compact→layout en junio; el logout global queda
  sustituido.

No se encontró en `local/docs` la especificación del loader de doce frames. Se
conserva únicamente como petición externa del usuario, sin atribución falsa a
un documento histórico.

## 17. Riesgos de resolver cada bloque mediante parches

| Bloque | Riesgo de parche aislado | Base obligatoria |
| --- | --- | --- |
| Ranking interactivo | Busy global, doble apertura o reachability falsa | gate SOL-005 + operation feedback + 3B.3 |
| Geometría biblioteca | Aumentar ancho y romper detalle/preferencia | regiones 3B.1 + valores contrastados CON-001 |
| Continuidad biblioteca | Resetear el scroll izquierdo o conservar el nodo equivocado al cambiar de pack | renderer regional 3B.1 + PR-011 |
| Hero favorito/readiness | Duplicar estado, romper fallback o confundir favorito con autoridad de pack | assets 3B.2 + presentación 3B.3 + PR-012 |
| Olvidar cuenta | Ocultar semántica destructiva o reabrir lifecycle de sesión por un cambio de hover | cuenta SOL-006 + foco 3B.1/3B.3 + PR-013 |
| Membership inicial | Crear segunda autoridad, polling o checking sin operación real | coordinador 4V.1B + revisiones 3A |
| Startup viewport | Segundo gate, espera infinita o callbacks stale | readiness y generación 3B.2 |
| Ubicación biblioteca | Confundir raíz, pack y selección; escribir al cancelar | root classifier + selección SOL-004 |
| Auth/secure storage | Borrar material ambiguo o prometer cifrado inexistente | repositorio canónico SOL-002 |
| QA conectividad | Tratar señales OS/producto como autoridad | health/gate SOL-005 |
| Space Invaders/MAME | Cambiar reglas por un fallo de entorno no medido | pack/runtime SOL-007 + QA PR-009 |
| Drawers/diálogos | Romper foco, Escape, backdrop o scroll | regiones 3B.1 + primitivas 3B.3 |
| Resumen post-run | Crear cola/estado paralelo o elegir solo mejor score | outcomes/cola SOL-003 |
| Loader/branding | Usar animación como readiness o ignorar reduced-motion | overlay/readiness 3B.2 |
| Footer/update | Afirmar “actualizado” sin autoridad | versión empaquetada; updater separado |
| Watcher | Tormenta de escaneos, flicker o pérdida de selección | raíz/selección/import SOL-004 |
| Integridad/catálogo | Seguridad parcial, overwrite o rollback imposible | PC-002 antes de PC-006 |
| Legacy | Romper packs/CLI/dev bridge aún dependientes | condiciones de deprecación PC-004 |

Regla de mantenimiento: una tarea futura debe citar los IDs que pretende mover y
actualizar su estado y evidencia. Los documentos de continuidad se registran en
la sección correspondiente sin renumerar el apéndice histórico, salvo que una
nueva tarea autorice expresamente otro censo completo. No debe reclasificar una
propuesta como requisito sin fuente aprobada ni cerrar un QA mediante inspección
estática.
