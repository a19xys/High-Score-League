# Inventario visual y funcional vivo — 3B.3

Este inventario no es una lista cerrada. Registra intención recuperada, estado
real y punto de extensión para evitar futuros parches. `Sí` en 3B.3 significa
base implementada y probada, no que todo el rediseño histórico esté terminado.

## Fuentes inspeccionadas

- `launcher-final-ux-blueprint-1.md`;
- `launcher-visual-foundation-1.md` y `launcher-ux-visual-polish-4.md`;
- `launcher-state-authority-3a.md`;
- `render-state-stability-audit-12.md` y la implementación posterior de 3B.1;
- `launcher-startup-theme-assets-3b2.md`;
- `connectivity-state-1.md`, `connectivity-ranking-reliability-2.md`,
  `remote-availability-gate-1.md`, `ranking-capability-stability-1.md`;
- `canonical-account-sessions-stabilization-2.md`,
  `account-menu-behavior-2.md`, `account-menu-polish-1.md`;
- `season-membership-check-2.md`, `pack-readiness-1.md`,
  `auto-sync-queue-1.md`, `submission-outcome-policy-1.md` y
  `activity-details-1.md`;
- historial reciente desde `16b7ba6` hasta `a3b2937` de renderer y docs;
- componentes, tokens/CSS y tests de presentación actuales;
- búsquedas acotadas de TODO/FIXME y pendientes documentados.

## Matriz

| Requisito o idea | Fuente | Área | Estado antes | 3B.3 | Aplazado | Confirmación | Dependencia | Riesgo como parche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Un significado común por estado | Tarea 3B.3 | Renderer | Condicionales duplicados | Sí: `product-presentation.js` | No | No | snapshots aceptados | Alto: contradicciones |
| Conectado solo por health confirmado | connectivity-state-1 | Header/remoto | Gate correcta, copy parcial | Sí, preservando gate | No | No | reachability | P0 si se usa navegador/displayStatus |
| Probe silencioso sin flicker | connectivity-state-1 | Header/live | Chip conservaba gate; live era amplio | Sí | No | No | probe phase | Alto |
| Missing/invalid no es offline | global-hsl-origin-1 + 3B.3 | Header/login/ranking | Chip específico aislado | Sí | No | No | remoteConfiguration | Alto |
| Sesión aplazada no perdida | canonical-account-sessions-stabilization-2 | Cuenta | Copy no unificada | Sí | No | No | resultado canónico | P0 conceptual |
| Cuenta recordada no equivale a autenticada | account-switcher-gui-2 | Cuenta | Parcial | Sí | No | No | knownAccounts/session | Alto |
| Login conserva email/password y selección | 3B.1 residual + 3B.3 | Formulario | Riesgo de sustitución regional | Sí | No | No | renderer regional | P2 con pérdida de entrada |
| Password fuera de store/persistencia/log | auth + docs de cuenta | Seguridad renderer | Ya fuera del store, sin preservación | Sí, contrato reforzado | No | No | IPC login existente | P0 de seguridad |
| Membership checking ≠ not_member | season-membership-check-2 | Detalle/acciones | Badges genéricos | Sí | No | No | membership normalizada | Alto |
| Unknown/error permite juego conservador | pack-readiness-1 | Competición | Autoridad correcta, copy ambigua | Sí, sin cambiar regla | No | No | canPlayCompetition | P0 si se cambia regla |
| Acción de inscripción | season-membership-check-2 + 3B.3 | Recuperación | URL existía; modelo no | Base semántica sí | UI dedicada futura | Sí, ubicación visual | joinUrl segura | Medio |
| Cola siempre explica seguridad local | auto-sync-queue-1 | Actividad | Inconsistente | Sí | No | No | queue/autoSync | Alto por alarma falsa |
| Pending ≠ deferred ≠ failed ≠ synced | submission-outcome-policy-1 | Actividad | Tres interpretaciones | Sí | No | No | outcome/autoSync | Alto |
| Un único resumen de badge | game-detail-polish-1 + 3B.3 | Detalle | Hasta cuatro chips | Sí | No | No | prioridad semántica | Alto |
| Pack legacy compatible no es error total | pack-readiness-1 | Detalle | Dos badges | Sí | No | No | bridge deprecated | Medio |
| Pack duplicado prioriza bloqueo | library-selection-state-robustness-3 | Detalle | Rutas privadas visibles | Sí; rutas solo diagnóstico | No | No | duplicateGroup | Alto |
| Práctica sigue si solo competición bloquea | pack-readiness-1 | Acciones | Regla correcta, razón ausente | Sí | No | No | canPractice | P0 si se acoplan |
| Biblioteca unconfigured/empty/missing/inaccessible | pack-directory-model-1 | Sidebar/fallback | Copy por rama | Sí para estados comunes | Casos de raíz específicos continúan | No | library.status | Medio |
| Ranking sin estado anterior | ranking-capability-stability-1 | Acción Ranking | Gate robusta | Sí, presentación común | No | No | stateSequence/weekId | P0 si se cachea en UI |
| Ranking no publicado ≠ error | 3B.3 | Acción Ranking | `unavailable` genérico | Sí | No | No | capability status | Medio |
| Busy no deja latch | operation-feedback-lifecycle-1 | Acciones | `disabled` por componente | Sí, derivación sin memoria | No | No | busy vigente | Alto |
| Razón accesible, no solo title | 3B.3 | Acciones | Ausente | Sí | No | No | primitives | Alto |
| Severidades comunes | 3B.3 | Tokens/UI | badge-ok/warn/error/muted | Sí | No | No | tokens claro/oscuro | Alto |
| Color no único indicador | 3B.3 + icon-system-1 | Estados | Parcial | Sí: icono+texto+borde | No | No | iconos locales | Alto |
| Copy española consistente | 3B.3 | Primera capa | Tildes y genéricos dispares | Sí en estados tocados | Revisión completa futura | No | modelos | Medio |
| Primera capa sin rutas privadas | blueprint + pack-readiness-1 | Detalle | Duplicate paths visibles | Sí | No | No | Diagnóstico | P1 privacidad |
| Live focalizada | 3B.3 | Accesibilidad | `#app aria-live` | Sí | No | No | región persistente | Alto |
| Errores login asociados | 3B.3 | Accesibilidad | Texto no asociado | Sí | No | No | ids estables | Alto |
| Focus/scroll/nodos persistentes | 3B.1 | Renderer | Estabilizado | Preservado | No | No | region-renderer | P0 si se remonta |
| Tema/primer pintado | 3B.2 | Tema | Estabilizado | Intacto | No | No | main/theme bootstrap | P0 si se reabre |
| Assets generacionales | 3B.2 | Hero/cards | Estabilizado | Intacto | No | No | asset preloader | P0 si UI elige autoridad |
| Filtros, vistas y resize | tareas library 2–10 | Sidebar | Funcionales | Contratos preservados | Rediseño adicional | No | preferencias 3B.1 | Alto si CSS aislado |
| Densidad 100/125/150 % | 3B.3 | Layout | CSS existente con mínimo 920 px | Tokens base; tests estáticos | QA visual físico | No | Electron/OS scale | Medio |
| Nueva vista de biblioteca | fuera de alcance 3B.3 | Biblioteca | No especificada | Punto de extensión | Sí | Sí | modelo y regiones | Alto sin confirmación |
| Navegación nueva | fuera de alcance 3B.3 | Shell | No especificada | No | Sí | Sí | blueprint futuro | Alto |
| Branding/personalización/animación avanzada | fuera de alcance 3B.3 | Visual | Intención genérica | No | Sí | Sí | diseño aprobado | Alto |
| Catálogo/descarga/instalador/updater | blueprint y fuera de alcance | Producto | Backlog | No | Sí | No para backlog; sí para UX final | servidor/distribución | P0 fuera de alcance |
| Especificación adicional de cambios menores futuros | Referencia no recuperada | Varias | No recuperado | No | Sí | Sí | petición futura | Alto si se inventa |
| `player-summary.js` legado sin consumidores runtime | Auditoría 3B.3 | Código renderer no montado | Duplicaba copy histórico, pero no se importa | No afecta a la UI 3B.3 | Retirada/refactor futuro | No | confirmar ausencia de nuevo consumidor | Medio si se elimina sin tarea |

## Trabajo implementado

- proyección común de once dominios y acciones;
- severidades, tokens y primitivas con uso real;
- consolidación del badge del juego;
- copy de seguridad de cola;
- razones deterministas y accesibles;
- login efímero con foco/selección;
- live region focalizada;
- retirada de rutas duplicadas de primera capa;
- pruebas de matrices, pureza, copy, accesibilidad y seguridad.

## Trabajo aplazado

- rediseños de pantallas, navegación o nuevas vistas;
- ubicación visual definitiva de acciones recuperables secundarias;
- refinamiento estético completo de todas las cards y dialogs;
- QA físico exhaustivo en 100 %, 125 % y 150 %;
- contraste instrumentado/WCAG completo;
- animaciones avanzadas o personalización;
- catálogo, descarga, instalador, updater y distribución.

## Requiere confirmación

- nuevas vistas e interacciones no descritas por los documentos existentes;
- contenido o branding adicional;
- posición definitiva de `Ver temporada` si pasa a primera capa;
- cualquier requisito histórico no presente en repo ni en 3B.3. Se registra
  como `no recuperado`; no se presume.

## Regla para tareas futuras

Antes de editar una pantalla, identificar el dominio en
`product-presentation.js`, reutilizar `status-primitives.js` y tokens
`--state-*`, mantener su región 3B.1 y consumir gates/capacidades existentes.
Si el trabajo necesita interpretar un enum nuevo directamente en un componente,
primero debe ampliar el modelo y sus pruebas. No tocar autoridad de snapshots,
conectividad, sesión, readiness, tema, startup o assets para resolver un cambio
puramente visual.

## Evidencia de cierre

- tests launcher local: 684/684;
- tests raíz: 9/9;
- smoke Electron real: procesos activos y respondiendo, sin error de consola y
  apagado limpio sin residuales;
- inspección visual real: no disponible porque el entorno no expuso un handle
  de ventana; no se sustituye por una afirmación simulada;
- matrices funcionales y de accesibilidad: cubiertas por tests deterministas;
- QA físico 100/125/150 %, lector de pantalla, contraste y servicios reales:
  aplazado y visible en el inventario.
