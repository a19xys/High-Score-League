# Selección robusta por biblioteca

## Modelo de estado

El escaneo clasifica la biblioteca como:

- `unconfigured`: no hay raíz configurada;
- `missing`: la raíz configurada no existe;
- `inaccessible`: la ruta no se puede usar como directorio;
- `available-empty`: la raíz existe y no contiene packs detectables;
- `available-populated`: contiene una o más instancias reales;
- `error`: existe otro error de configuración o escaneo.

El estado `loading` es transitorio en el renderer mediante `busy`: antes de cambiar de raíz o reescanear se neutralizan `activePack`, `game`, bridge y selección visual. El siguiente render aplica conjuntamente biblioteca, selección, detalle y hero devueltos por el servicio.

`activePack` solo admite dos formas: una entrada real de `library.packs` o `null`. Una biblioteca sin configurar, no disponible o vacía siempre produce `activePack: null`. Un pack roto continúa siendo una instancia real y puede seleccionarse, aunque readiness impida jugarlo.

## Identidad y reconciliación

`reconcileLibrarySelection` centraliza la política después de cada escaneo:

1. Conserva la instancia activa si pertenece a la misma raíz y sigue en el resultado.
2. Recupera la instancia recordada para esa raíz si sigue presente.
3. Selecciona el primer pack según `gui/shared/library-order.mjs`, la misma ordenación que usa la interfaz.
4. Devuelve selección nula si no existe ninguna instancia real.

La pertenencia y el marcado visual se comparan por `instanceKey` y ruta normalizada, nunca solo por `packId`. Por ello dos carpetas con el mismo `packId` conservan identidades distintas. El detalle exige además que `game.instanceKey`, `selection.activeInstanceKey` y la entrada de biblioteca coincidan.

## Persistencia

`userData/libraries/selection.json` almacena un mapa cuya clave es la raíz normalizada y cuyo valor contiene únicamente `instanceKey`, ruta relativa del pack y fecha de actualización. No persiste títulos, metadata, assets ni el objeto pack.

`recent.json` se admite como migración de compatibilidad solo si su ruta coincide exactamente con una instancia de la biblioteca actual. En ese caso se escribe la nueva entrada por raíz. Un recuerdo inválido nunca se materializa y cae al primer pack real.

Desconectar una unidad conserva el recuerdo de su raíz, pero limpia la selección activa. Reconectar restaura ese recuerdo si sigue siendo válido. Cambiar a otra raíz consulta exclusivamente la entrada de esa nueva raíz. Favoritos, preferencias y colas no se modifican.

## Cambios y recuperación

Un cambio de ubicación correcto limpia primero el estado activo del servicio y reconcilia una vez contra el escaneo definitivo. Una carpeta vacía es válida: queda `available-empty`, sin cards marcadas, detalle de juego ni acciones. Un selector cancelado o una ruta missing rechazada no cambia la configuración anterior.

En el renderer, las acciones de cambio y reescaneo están bloqueadas por `busy` y neutralizan el detalle durante la espera. La selección de cards usa un contador `libraryPackSelectionSequence` para descartar respuestas antiguas. Cada render reemplaza por completo la rama del detalle, por lo que un empty state no reutiliza `src`, metadata o datasets del hero anterior. La rama también prioriza `library.status` frente a cualquier dato `game` residual.

## Empty states

- no disponible: **Biblioteca no disponible**;
- sin configurar: **Configura tu biblioteca**;
- vacía: **Tu biblioteca está vacía**;
- poblada sin selección válida: **Elige un juego de tu biblioteca**.

Todos usan `hero_hsl.png` y un fallback CSS de marca si la imagen falla. No muestran metadata, badges ni acciones de juego.

## Fallback eliminado y diagnóstico

El servicio ya no consulta el primer juego soportado ni usa `invaders`, `space-invaders` o `Space Invaders` para construir el detalle o lanzar MAME. La ausencia de selección produce `game: null`; `Sin datos` solo se conserva para campos concretos de un pack real.

Los logs de diagnóstico incluyen estado y raíz de biblioteca, número de packs, instancia activa, instancia recordada y origen (`user`, `remembered`, `first-available` o `none`). El diagnóstico recomienda revisar el estado si detecta que una instancia activa no pertenece a la biblioteca actual.
