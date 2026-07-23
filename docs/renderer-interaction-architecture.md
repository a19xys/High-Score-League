# Arquitectura de interacción del renderer

## Motivo

El renderer montaba de nuevo todo `#app` tras cada `store.setState()`. La búsqueda se destruía en cada pulsación y se enfocaba de nuevo manualmente; conectividad, Ranking, cola, preferencias y resize también recreaban controles, imágenes y observers sin necesitarlo.

## Modelo final

`#app` se monta una sola vez. El store sigue siendo la única fuente de verdad y cada snapshot completo aceptado sigue entrando como una unidad coherente. Después, un coordinador pequeño compara el HTML derivado de cada región con su última versión y solo escribe en el DOM si esa región cambió.

Las regiones son:

- encabezado: conectividad, tema y cuenta;
- biblioteca: cabecera, toolbar/filtros y lista de packs;
- detalle: visuales, estado, identidad/metadatos, acciones y actividad;
- overlay, diálogo y busy overlay;
- contenedores estructurales de biblioteca y detalle.

El footer y el shell son persistentes. El ancho del sidebar se aplica directamente como propiedad CSS y tiene un fast path exclusivo durante `pointermove`.

## Invalidación e identidad

Cada renderizador sigue siendo una función pura de estado a HTML. `region-renderer.js` conserva una instantánea por nombre de región. Si el HTML derivado no cambia, no toca el nodo: por eso conectividad no reemplaza la búsqueda, Ranking no reemplaza la toolbar, una actualización de cola no recrea el hero y un snapshot remoto sin cambios visibles no desmonta el menú de cuenta.

La búsqueda no codifica su valor en el HTML derivado. Su valor visible se sincroniza como propiedad solo cuando el input no está activo; al escribir, cambia únicamente la lista de packs y el propio nodo conserva texto, cursor y selección de forma nativa.

Biblioteca y `.game-scroll` permanecen montados. La lista cambia dentro de su propio scroller, así que conserva `scrollTop`. En detalle, las actualizaciones del mismo pack cambian subregiones internas; un cambio real de clave de pack reconstruye el contenido y reinicia solo el scroll de detalle.

## Foco, overlays y diálogos

Una escritura de región relevante captura una identidad semántica (`data-focus-key`, `id`, `name` o acción más sus calificadores), valor y selección. Solo restaura foco si el control equivalente sigue existiendo. Los descendientes marcados con `data-preserve-scroll` recuperan su posición tras una reconstrucción justificada.

Los diálogos mantienen su foco inicial. Overlays y diálogos recuerdan el elemento que los abrió y devuelven el foco al cerrarse si ese nodo continúa conectado. El menú de cuenta es una región independiente: eventos irrelevantes no lo escriben; logout, switch, Escape y las acciones que lo exigen conservan el cierre explícito existente.

## Listeners, observers y lifecycle

Los listeners continúan delegados en `root` y se enlazan una sola vez después del montaje. No hay listeners por región ni por render.

Los `ResizeObserver` de metadatos y favorito solo se resincronizan si cambian la identidad/visuales del detalle o su estructura. Conectividad, Ranking, cola o preferencias no los recrean. Antes de descargar se desconectan ambos observers, se cancelan sus `requestAnimationFrame`, se limpia el debounce de preferencias y se retiran las señales de conectividad.

## Renders completos que permanecen

Solo se reemplaza el contenido completo de biblioteca al cruzar entre carga y datos disponibles. El detalle se reemplaza al cambiar entre carga, fallback y pack, o al seleccionar otra identidad real. Son fronteras estructurales: sus árboles no comparten controles interactivos que deban persistir. El shell global no vuelve a renderizarse después del montaje.

## Contratos preservados y trabajo posterior

La gate de `launcherStateRevision`, los eventos parciales de conectividad, `stateSequence` de Ranking, las secuencias de selección/preload y la revisión local de preferencias no cambian. La invalidación ocurre después de aceptar el estado y nunca compone fragmentos de snapshots distintos.

3B.2 conserva el primer pintado, readiness de startup, tema Sistema y tratamiento visual profundo de hero/logo/placeholders. 3B.3 conserva el rediseño de Ranking, badges y mensajes, densidad final y QA general de accesibilidad/visual.
