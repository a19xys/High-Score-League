# LOCAL PRE-BETA PRODUCT STATES AND VISUAL SYSTEM 3B.3

Base semántica reutilizable entre el estado canónico del launcher y su
presentación. Este hito no cierra el diseño visual ni crea una nueva autoridad.

## Alcance y punto de partida

Base verificada: `a3b293743c937e41e32c26541755f82fb888fba0`, rama
`master`, árbol limpio. En el baseline pasaban 662 pruebas locales y 9 pruebas
raíz. El único warning repetido era `MODULE_TYPELESS_PACKAGE_JSON` al importar
módulos ESM del renderer desde `node --test`.

Los problemas reproducidos antes del cambio fueron:

- `game-panel.js`, `queue-panel.js` y `header.js` interpretaban los mismos
  estados con tablas y condicionales distintos;
- un estado `idle/not_eligible` de autoenvío podía aparecer como
  `Auto-sync activo` aunque hubiera un bloqueo más importante;
- el detalle podía mostrar hasta cuatro badges redundantes o contradictorios;
- los botones principales dependían de `disabled` y `title`, sin una razón
  asociada accesible;
- las rutas de packs duplicados aparecían en la primera capa;
- una sustitución relevante de la región de cuenta podía vaciar email,
  contraseña, cursor y selección;
- `#app` era una región `aria-live`, por lo que un render regional podía
  anunciar una porción excesiva de la aplicación;
- configuración remota, offline y comprobación de conectividad no tenían una
  taxonomía visual común.

## Arquitectura

`gui/renderer/product-presentation.js` es una función de proyección pura:

```text
snapshot completo ya aceptado + eventos parciales ya aceptados
  -> modelos semánticos de producto
  -> primitivas HTML y tokens
  -> regiones existentes
```

Cada modelo usa, según corresponda:

- `domain` y `status` semántico;
- `severity`;
- `title` y `description` de producto;
- `icon`;
- `priority` visual;
- `available`, `reason` y `reasonId` para acciones;
- acción recuperable opcional;
- metadatos de accesibilidad como `confirmed` o `silent`.

La proyección no hace fetch, no persiste, no llama IPC, no escribe el store, no
modifica snapshots y no acepta ni rechaza revisiones. Tampoco sustituye
`readiness.canPractice`, `readiness.canPlayCompetition`,
`membership.canPlayCompetition`, la gate de Ranking ni la compuerta remota.

## Dominios

### Conectividad y configuración remota

`deriveConnectivityPresentation()` distingue:

- desconocido;
- comprobando;
- conectado confirmado;
- reconectando;
- offline;
- suspendido;
- error de comprobación;
- configuración HSL ausente;
- configuración HSL inválida.

`Conectado` solo obtiene `confirmed: true` si `reachability === "connected"`.
Un probe background conserva el estado comprometido y marca `silent: true`; no
hace parpadear el chip ni genera un anuncio. Missing/invalid pertenecen al
dominio `remote-configuration`, no se describen como fallo de Internet.

La compuerta de acciones remotas continúa siendo
`deriveRemoteAvailability(connectivity)`. La presentación explica el motivo,
pero no eleva un estado desconocido ni `displayStatus` a disponibilidad.

### Sesión y cuentas

`deriveSessionPresentation()` separa sin sesión, activa, actualizándose,
aplazada, requiere login, cambio de cuenta y cuenta recordada sin sesión. Una
sesión aplazada conserva el texto explícito de que no se ha perdido. Una cuenta
recordada no se presenta como autenticada si carece de sesión válida.

`deriveRememberedAccountPresentation()` da la misma interpretación a las filas
del selector de cuenta. Los detalles técnicos de sesión siguen fuera de la
primera capa.

### Membership

`deriveMembershipPresentation()` distingue checking, member, not_member,
no_session, requires-login, missing_week, invalid_week, unknown, deferred y
error temporal. `unknown/error` no cambian la regla competitiva conservadora:
pueden permitir jugar si la autoridad canónica lo permite, mientras la subida
queda protegida por sus reglas existentes.

`not_member` expone una acción semántica `Ver temporada` cuando existe una URL
ya validada. Esta tarea no cambia la validación ni abre una URL distinta.

### Cola y autoenvío

`deriveQueuePresentation()` prioriza:

1. failed/partial_failed que requiere atención;
2. envío en curso;
3. aplazamiento;
4. pendientes normales;
5. sincronización completada;
6. cola sin pendientes.

Pending, deferred, syncing y failed explican que las puntuaciones siguen
guardadas localmente. `Auto-sync activo` deja de ser un éxito genérico. El
detalle técnico conserva el enum raw únicamente dentro de `Detalles técnicos`.

### Pack, readiness y biblioteca

`derivePackPresentation()` distingue sin selección, duplicado, MAME ausente,
pack inválido, legacy compatible, aviso estructural, práctica disponible con
competición bloqueada y ready. Usa capacidades ya calculadas; no vuelve a
evaluar archivos.

Las rutas duplicadas se retiran de la primera capa. Diagnóstico conserva la
trazabilidad técnica. `deriveLibraryPresentation()` cubre directorio no
configurado, missing, inaccesible, biblioteca vacía, sin selección y lista.
Clasificaciones más específicas de raíz siguen en el componente de biblioteca
porque son contratos locales ya estabilizados, no enums globales de producto.

### Ranking

`deriveRankingPresentation()` consume la gate existente y distingue falta de
weekId, offline, checking, available, no publicado, error temporal,
configuración remota inválida y apertura en curso. No cambia cache,
`stateSequence`, identidad, origen seguro, generación ni apertura sin busy
global.

## Precedencia de bloqueos

Competición usa esta precedencia determinista:

1. operación global en curso;
2. ausencia de pack;
3. bloqueo estructural del pack: duplicado, inválido o MAME no disponible;
4. sesión que requiere login;
5. ausencia de sesión;
6. membership que bloquea competir;
7. otro blocker canónico de readiness.

`requiresLogin` precede a `no_session` para que una cuenta recordada que necesita
reautenticación no se describa como una cuenta nueva. La disponibilidad final
sigue siendo la conjunción de los booleanos canónicos ya existentes.

Práctica usa: busy, ausencia de pack y `readiness.canPractice`. Por ello puede
seguir disponible cuando solo membership, sesión o captura competitiva
bloquean Competición.

Manual usa: busy, ausencia de pack y `game.manual.available`. Ranking usa busy
más su gate semántica. Al terminar busy, una nueva derivación vuelve a habilitar
la acción sin latch local.

Las acciones auxiliares de login, cambio de cuenta, restaurar, comprobar
conexión, comprobar membership, cambiar/reescanear/importar/abrir biblioteca
usan el mismo contrato `{available, reason, reasonId}`. La UI nunca usa la
capa para saltarse la validación del handler.

## Severidades y primitivas

Severidades disponibles:

| Severidad | Uso |
| --- | --- |
| `neutral` | estado sin confirmar o sin actividad |
| `info` | información útil no bloqueante |
| `progress` | operación transitoria |
| `success` | resultado confirmado |
| `warning` | degradación o recuperación automática posible |
| `error` | fallo que requiere atención |
| `blocked` | acción o capacidad no disponible |

Los tokens `--state-*` tienen variantes claras y oscuras. Icono, texto, borde
y superficie acompañan al color. Los tokens adicionales de altura, icono,
radio y espaciado solo existen porque los consumen las primitivas actuales.

`components/status-primitives.js` aporta:

- `renderStatusBadge`;
- `renderContextNotice`;
- `renderAvailabilityButton`;
- `renderBlockingReasons`.

La política de badges del detalle es un único resumen priorizado. Cola vive en
Actividad y sesión en el header/menú, de modo que no compiten cuatro chips por
explicar la misma disponibilidad. Los detalles secundarios se expresan en
texto contextual, actividad o Diagnóstico.

Cada botón no disponible es un `button` nativo `disabled`, añade
`aria-disabled`, referencia una razón mediante `aria-describedby` y mantiene
`title` solo como ayuda complementaria.

## Copy

La primera capa usa título corto más impacto/recuperación cuando aporta valor.
No muestra enum, userId, rutas, tokens, payloads, stack traces o códigos de
Supabase. Los estados de cola evitan sugerir pérdida si el archivo permanece
local. Los textos usan español con tildes y distinguen comprobar, aplazar,
bloquear y fallar.

Copy técnica raw permanece permitida en Diagnóstico o `Detalles técnicos`
sanitizados. No debe reutilizarse como copy principal.

## Login efímero

`login-draft.js` mantiene un borrador en el cierre léxico de la instancia del
renderer. No forma parte del store, snapshot, persistencia, log ni repositorio.
Antes de sustituir `header-account`, captura email, contraseña, foco y selección;
después restaura sobre el formulario nuevo. La contraseña solo sale mediante
`take(form)` al submit explícito y cruza el IPC ya existente de login.

El borrador se limpia al cerrar/cancelar el formulario, tras login correcto,
al iniciar cambio de cuenta, al olvidar/cerrar la cuenta mediante una acción
que cierra el menú y en `beforeunload`. Un login fallido puede conservarlo para
permitir corregir el formulario; sigue siendo memoria efímera del renderer.

## Foco y anuncios

3B.1 sigue siendo dueño de render regional, captura/restauración de foco,
dialogs, overlays y listeners delegados. 3B.3 solo añade preservación específica
del formulario de login.

`#app` ya no tiene `aria-live`. Existe un único `#hsl-live-status` persistente y
oculto visualmente. Solo anuncia:

- transición relevante a conectado/offline/error confirmado;
- resultado nuevo de una acción en logs;
- error inicial recuperable;
- transición relevante de cola a failed o synced.

No anuncia probes background, checking de Ranking, cards, preferencias ni
renders regionales. El error de login usa `role="alert"` y queda asociado a
ambos campos. `prefers-reduced-motion` sigue suprimiendo movimiento no esencial.

## Integración con 3A, 3B.1 y 3B.2

- 3A: `launcherStateRevision` sigue entrando por `launcher-state-gate.js`. La
  proyección se ejecuta después y no conoce la revisión.
- 3B.1: `#app` se monta una vez; se conservan regiones, fast path, identidad de
  nodos no relacionados, listeners y observers.
- 3B.2: tema, startup y autoridad generacional de assets no cambian. La capa no
  elige URLs ni resuelve imágenes.

## Alternativas descartadas

- duplicar un view-store: habría creado una segunda fuente de verdad;
- persistir campos del formulario: incompatible con contraseña efímera;
- añadir condiciones por componente: mantendría las contradicciones;
- convertir `title` en explicación única: no es suficiente para teclado ni
  lectores de pantalla;
- reemplazar la gate remota por `displayStatus`: rompería la autoridad de
  health;
- migrar a un framework o rehacer CSS: fuera de alcance.

## Extensión futura

Para añadir un estado:

1. añadir una rama al derivador de su dominio;
2. producir un modelo existente, sin leer enums directamente desde el
   componente;
3. probar la matriz y la inmutabilidad;
4. renderizar con una primitiva existente.

Una nueva severidad solo se justifica si neutral/info/progress/success/warning/
error/blocked no expresan su comportamiento. Debe añadir metadatos, tokens
claro/oscuro y test de icono+texto, no solo un color.

Una razón nueva se añade a la precedencia del derivador de acciones y usa un
`reasonId` estable. Copy compartida vive con la derivación, no en tooltips
duplicados. Una acción recuperable usa `primaryAction`/`secondaryAction` y un
handler ya autorizado.

Una vista futura debe reutilizar modelos, primitivas, tokens y regiones. No
debe tocar gate de snapshots, autoridad remota, readiness, foco regional,
tema, startup o resolución generacional de assets.

## Verificación de cierre

La batería final ejecutada el 26 de julio de 2026 queda en 684/684 pruebas del
launcher local y 9/9 pruebas del proyecto raíz. `git diff --check` se ejecuta
como control final independiente.

El smoke real arrancó Electron mediante `npm.cmd --prefix local/hsl-local-app
run gui`: el proceso principal y sus procesos Electron quedaron activos y
respondían, no apareció ningún error de arranque en consola y el cierre por
`SIGINT` terminó sin procesos residuales. El entorno de ejecución no expuso un
`MainWindowHandle`, por lo que este smoke no se presenta como inspección visual.

Las matrices de conectividad, sesión, membership, cola, pack, biblioteca,
Ranking, bloqueo de acciones, accesibilidad y borrador de login se comprobaron
de forma determinista en tests. Queda como QA manual explícitamente pendiente
la inspección pixel a pixel, escalas físicas 100/125/150 %, lector de pantalla,
contraste instrumentado y recorridos con cuentas/servicios remotos reales.
