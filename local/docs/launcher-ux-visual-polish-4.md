# Pulido visual y de feedback del launcher

## Feedback de reescaneo

La capa fugaz era el `busy-overlay` correcto, no el dialogo de biblioteca no disponible. El reescaneo podia terminar antes de que el usuario llegase a percibir la capa.

Las operaciones explicitas pueden declarar una duracion visual minima. El reescaneo usa 600 ms: la operacion empieza de inmediato y, al terminar con exito o error, solo se espera el tiempo visual restante. La comprobacion del identificador de ejecucion evita que una operacion antigua cierre el feedback de una intencion posterior. Startup, tareas automaticas e importaciones largas no heredan esta espera.

## Dialogos

Los botones de `app-dialog` consumen variantes semanticas `primary` y `secondary`. Los colores secundarios se definen mediante tokens por tema. En oscuro, la superficie secundaria es azul marino con borde azul grisaceo y deja de mezclar la superficie generica casi negra del modal. Los iconos heredan `currentColor`.

## Capacidades de biblioteca

La disponibilidad estructural se deriva con `getLibraryCapabilities` y no depende de `busy`:

- `unconfigured`, `missing` e `inaccessible` cierran y deshabilitan Filtros y vistas.
- `available-empty` mantiene Filtros y vistas habilitados como preferencias validas para el primer pack importado.
- `available-populated` mantiene el comportamiento normal.

El busy overlay bloquea la interaccion sin contraer Filtros, cambiar `aria-expanded`, deshabilitar visualmente las vistas ni modificar `libraryView`.

## Elevacion y tarjetas

Los tokens `--shadow-card`, `--shadow-card-hover`, `--shadow-panel`, `--shadow-dialog` y `--shadow-none` separan la elevacion de otros estados. En claro, las cards usan una sombra azul grisacea breve y difusa. En oscuro, el borde y la superficie aportan la mayor parte de la separacion.

La sombra pertenece al shell exterior. El scrollport incorpora un gutter y `scroll-padding` para reservar el blur en primera y ultima fila y en la ultima columna. Las imagenes y stages interiores no proyectan una sombra independiente.

Portadas e Iconos comparten la anatomia shell, media/stage, contenido y overlays. Portadas reserva padding entre portada y shell. Iconos reserva padding dentro del stage y espacio vertical bajo el titulo. Lista conserva su densidad horizontal y consume el mismo stage funcional para sus miniaturas.

## Seleccion y foco

Las tres vistas emiten el mismo estado semantico desde el `instanceKey` activo: clase `pack-card--active`, `data-selected="true"` y `aria-current="true"`. Un unico pseudo-elemento dibuja el ring interior de 2 px y su halo; el borde base permanece neutral. Hover solo ajusta elevacion/superficie, `focus-visible` conserva un outline exterior y pending usa el tono warning en lugar del ring selected.

## Icon window

La linea blanca superior procedia de un `inset 0 1px` aplicado al media en tema claro, no de los assets. Lista e Iconos comparten ahora una ventana de luminancia media con highlight y sombra azulados. El artwork de tipo icon usa `object-fit: contain` y un overscan comun de 1.18; un cover usado como fallback conserva `contain`, padding y escala 1.

Las cards de Iconos son containers inline. El titulo usa `clamp(12px, 10cqi, 14px)`, por lo que crece o permanece estable al aumentar la tarjeta. Gap y padding vertical proceden de tokens compartidos.

Los LEDs ready, warning y error usan los mismos nucleos saturados en ambos temas. El tema solo cambia el contorno; highlight y glow mantienen legibilidad sobre el stage.

## Tema y subtitulos

Un script sincronico en `head` valida la preferencia y aplica `data-theme` y `color-scheme` antes del CSS. `app.js` reutiliza `window.__HSL_INITIAL_THEME__`; Electron permanece oculto hasta `ready-to-show` para no exponer el fondo previo al primer frame listo.

Los subtitulos separan wrapper de icono y texto. Flex, caja optica fija y el nuevo SVG de calendario 24x24 eliminan la dependencia de la baseline y conservan `currentColor`.

## Diferencias deliberadas entre temas

Ambos temas mantienen la misma anatomia y estados. Claro usa superficies luminosas y elevacion suave; oscuro usa superficies azul marino, bordes mas presentes y sombras mas contenidas. Los rings y botones secundarios cambian de token para conservar contraste sin igualar visualmente ambos temas.
