# LOCAL-LAUNCHER-LIBRARY-BREAKPOINT-POLISH-5

Pulido del breakpoint responsive comun de biblioteca.

## Sidebar

La anchura minima de la sidebar baja a:

```text
320px
```

El maximo se mantiene en `600px` y el valor por defecto en `440px`.

## Breakpoint Comun

La biblioteca usa un unico breakpoint estrecho:

```css
@container (max-width: 340px)
```

Ese mismo punto activa:

- `Portadas` pasa de 2 columnas a 1 columna;
- los botones `Portadas`, `Lista`, `Iconos` ocultan texto y quedan solo con
  icono visible.

## Portadas

En modo normal, `Portadas` usa maximo 2 columnas y reduce sus cards
progresivamente manteniendo `aspect-ratio: 2 / 3`. En modo estrecho usa una
columna que ocupa el ancho util para evitar margenes laterales excesivos.

## Iconos

`Iconos` mantiene tile fijo. Desde
`LOCAL-LAUNCHER-LIBRARY-MICROPOLISH-SORT-SCROLL-7` el valor vigente es:

```text
122px
```

La sidebar cambia columnas y huecos, pero no el tamaño del tile. El tile sigue
manteniendo `aspect-ratio: 1 / 1`.

## Controles

La fila queda:

```text
[Añadir ubicación/Cambiar ubicación] [Filtros]
```

Si el breakpoint estrecho se activa, se apila en el mismo orden.

`Filtros` queda neutro cerrado y solo usa azul circuito cuando esta abierto.
El gap entre `Biblioteca` y los controles baja para que la cabecera se perciba
como un bloque compacto.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CONTROLS-FIX-SORT-6

La regla de modo estrecho oculta solo `library-view-button__label`; el icono
queda separado en `library-view-button__icon`, visible y centrado. La clase
activa de `Mas filtros` gana especificidad con
`.library-control-button.library-filter-toggle--open`. La tarjeta de filtros
incluye `ORDENAR` con criterio y direccion.

## Continuidad LOCAL-LAUNCHER-LIBRARY-MICROPOLISH-SORT-SCROLL-7

`Iconos` conserva tile fijo, ahora de 122px, para aprovechar la sidebar: 2
columnas en 320px y 4 columnas en 600px. Se mantiene el breakpoint comun de
340px para `Portadas` y botones solo icono.

## Continuidad LOCAL-LAUNCHER-LIBRARY-POLISH-STATUS-FAVORITES-8

La sidebar conserva minimo `320px` y maximo `600px`. Con el tile `122px`, gap
horizontal `8px` y scrollbar reservado, `Iconos` mantiene 2 columnas en minimo
y 4 columnas en maximo. La estrella queda cuadrada redondeada y la primera fila
de controles usa `Añadir ubicación` / `Cambiar ubicación` y `Filtros`.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CORRECTION-BADGES-SCROLL-9

Se confirma el objetivo 2/4 con tile `122px`, sin cambiar los limites
`320px`/`600px`. `Portadas` estira cards por fila, pero no fuerza altura global
de dos lineas cuando todos los titulos son cortos.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS, membership,
scoped queue, auto-sync, contrato de packs, catalogo, descarga, competicion v2,
cuenta, footer, panel derecho, favoritos scoped ni actividad local.
