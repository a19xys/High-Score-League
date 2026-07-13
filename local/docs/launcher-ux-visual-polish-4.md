# Pulido visual y de feedback del launcher

## Feedback de reescaneo

La capa fugaz era el `busy-overlay` correcto, no el dialogo de biblioteca no disponible. El reescaneo podia terminar antes de que el usuario llegase a percibir la capa.

Las operaciones explicitas pueden declarar una duracion visual minima. El reescaneo usa 600 ms: la operacion empieza de inmediato y, al terminar con exito o error, solo se espera el tiempo visual restante. La comprobacion del identificador de ejecucion evita que una operacion antigua cierre el feedback de una intencion posterior. Startup, tareas automaticas e importaciones largas no heredan esta espera.

## Dialogos

Los botones de `app-dialog` consumen variantes semanticas `primary` y `secondary`. Los colores secundarios se definen mediante tokens por tema. En oscuro, la superficie secundaria es azul marino con borde azul grisaceo y deja de mezclar la superficie generica casi negra del modal. Los iconos heredan `currentColor`.

## Biblioteca sin packs

En estados `unconfigured`, `missing`, `inaccessible`, `available-empty` o ante una lista vacia definitiva:

- Filtros permanece visible, cerrado y deshabilitado.
- Portadas, Lista e Iconos permanecen visibles y deshabilitados.
- La vista elegida se conserva en las preferencias y se reactiva cuando vuelven a existir packs.
- Cambiar ubicacion y el reescaneo disponible mantienen su politica propia.

Durante una operacion `busy` se bloquean temporalmente los controles de filtros y vistas para impedir acciones contradictorias.

## Elevacion y tarjetas

Los tokens `--shadow-card`, `--shadow-card-hover`, `--shadow-panel`, `--shadow-dialog` y `--shadow-none` separan la elevacion de otros estados. En claro, las cards usan una sombra azul grisacea breve y difusa. En oscuro, el borde y la superficie aportan la mayor parte de la separacion.

La sombra pertenece al shell exterior. El scrollport incorpora un gutter y `scroll-padding` para reservar el blur en primera y ultima fila y en la ultima columna. Las imagenes y stages interiores no proyectan una sombra independiente.

Portadas e Iconos comparten la anatomia shell, media/stage, contenido y overlays. Portadas reserva padding entre portada y shell. Iconos reserva padding dentro del stage y espacio vertical bajo el titulo. Lista conserva su densidad horizontal y consume el mismo stage funcional para sus miniaturas.

## Seleccion y foco

Las tres vistas emiten el mismo estado semantico desde el `instanceKey` activo: clase `pack-card--active`, `data-selected="true"` y `aria-current="true"`. Un pseudo-elemento del shell dibuja un ring interior de 2 px y un glow tematico sin cambiar dimensiones. Hover solo ajusta elevacion/superficie y `focus-visible` conserva un outline exterior independiente de 3 px.

## Icon stage

La linea blanca superior procedia de un `inset 0 1px` aplicado al media en tema claro, no de los assets. Lista e Iconos usan ahora un stage compartido sin inset ni sombra, con `object-fit: contain` y padding propio. El fondo claro conserva contraste para iconos blancos, amarillos, transparentes y pixel art; el oscuro mantiene una superficie azul marino coherente.

## Diferencias deliberadas entre temas

Ambos temas mantienen la misma anatomia y estados. Claro usa superficies luminosas y elevacion suave; oscuro usa superficies azul marino, bordes mas presentes y sombras mas contenidas. Los rings y botones secundarios cambian de token para conservar contraste sin igualar visualmente ambos temas.
