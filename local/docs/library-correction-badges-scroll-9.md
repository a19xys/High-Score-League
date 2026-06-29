# LOCAL-LAUNCHER-LIBRARY-CORRECTION-BADGES-SCROLL-9

Correccion de malentendidos visuales de biblioteca.

## Scrollbar

Chromium no expone una forma fiable de forzar que el thumb nativo ocupe todo el
carril cuando el contenedor no tiene overflow. Se mantiene `overflow-y: scroll`
y `scrollbar-gutter: stable`, y se añade un indicador visual no interactivo en
`.library-section--packs::after` para que la sidebar conserve un thumb visible
tambien con poco contenido.

Cuando hay overflow, el scroll nativo sigue funcionando. El indicador visual no
captura puntero ni crea una segunda interaccion.

## Iconos

La vista `Iconos` queda con tile fijo:

```text
122px
```

Con gap horizontal `8px`, sidebar minima `320px` y maxima `600px`, caben 2
iconos por fila en minimo y 4 por fila en maximo sin cambiar los limites de la
sidebar.

## Favoritos

La estrella mantiene caja cuadrada redondeada en todas las vistas. En `Lista`
se evita el recorte anterior subiendo la caja a `28px`.

## Selects

Se corrige el malentendido: no se aplica color especial a `option:checked`.
Solo se intenta tematizar `option:hover` con color circuito. El popup de
`select` sigue siendo nativo y puede variar en Windows/Chromium.

## Calendario

`Pack local` usa `inline-flex` y el icono de calendario recibe un ajuste
vertical fino para alinear visualmente con el texto.

## Portadas

`Portadas` no reserva siempre dos lineas de titulo. Mantiene `line-clamp: 2`,
pero elimina el `min-height` fijo. El grid estira las cards por fila; si una
card de la fila necesita dos lineas, su hermana se iguala, y si ambas tienen una
linea pueden quedar mas bajas.

## Badges

La biblioteca deja de mostrar estados tecnicos visibles como `INSTALADO`,
`DESINSTALADO`, `CON ERRORES` y `LEGACY`. Esos estados pasan al detalle del
juego seleccionado en una tarea futura.

De momento, todos los elementos de biblioteca muestran un unico placeholder:

```text
ABIERTO
```

Estados visuales preparados:

- `ABIERTO`: verde, `week-status--open`;
- `ACABANDO`: morado, `week-status--ending`;
- `CERRADO`: amarillo advertencia, `week-status--closed`.

El borde/ovalo y el texto usan el mismo color mediante `currentColor`.

## Fuera De Alcance

No se implementan estados remotos reales desde la web, catalogo, instalacion,
desinstalacion, regalos sorpresa, MAME, runtime, plugin, captura, endpoints,
RLS, membership, scoped queue ni auto-sync.
