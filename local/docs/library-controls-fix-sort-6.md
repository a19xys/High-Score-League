# LOCAL-LAUNCHER-LIBRARY-CONTROLS-FIX-SORT-6

Correccion de controles compactos y ordenacion basica de biblioteca.

## Controles

`Filtros` usa el estado real `libraryFiltersOpen`:

- cerrado: boton neutro, igual que `Añadir ubicación` / `Cambiar ubicación`;
- abierto: clase `library-filter-toggle--open` y acento circuito.

El selector CSS activo tiene suficiente especificidad para ganar a la regla
neutra del boton cerrado.

Los botones `Portadas`, `Lista` e `Iconos` separan estructura:

```text
library-view-button__icon
library-view-button__label
```

En el breakpoint estrecho de `340px` se oculta solo el label. El icono queda
visible, centrado y con tamano explicito.

El orden superior se mantiene:

```text
[Añadir ubicación/Cambiar ubicación] [Filtros]
```

Si se apilan, el boton de ubicacion queda arriba.

## Espaciado

El gap bajo `Biblioteca` se compacta reduciendo el gap de `.library-panel` y
eliminando el margen inferior de la cabecera dentro del panel de biblioteca.

## Ordenar

La tarjeta `Filtros` incluye la seccion compacta `ORDENAR` con:

- criterio: `Semanas`, `Alfabetico`, `Desarrollador`, `Ano`;
- direccion: `Asc`, `Desc`.

Defaults:

```text
librarySortBy = "weeks"
librarySortDirection = "asc"
```

## Comportamiento

La biblioteca filtra primero por busqueda, temporada y estado interno. Despues
ordena.

`Semanas` conserva los grupos actuales de temporada/semana y ordena por
temporada, numero de semana, `weekId` y titulo.

`Alfabetico`, `Desarrollador` y `Ano` muestran una lista plana sin encabezado
de temporada. Si hay filtro de temporada activo, se respeta el filtro pero el
resultado sigue siendo plano.

La ordenacion se persiste en las preferencias de biblioteca junto a vista y
anchura de sidebar. Con sesion se guarda por `playerKey`; sin sesion usa el
fallback global de preferencias. No guarda tokens ni correos.

## Continuidad LOCAL-LAUNCHER-LIBRARY-MICROPOLISH-SORT-SCROLL-7

`ORDENAR` elimina los labels visibles `Criterio` y `Direccion`. La direccion ya
no es un `select`: es un boton toggle con `arrow-up.svg` / `arrow-down.svg` y
fallback local. El tile fijo de `Iconos` queda en 122px para encajar 2 columnas en
sidebar minima y 4 en sidebar maxima.

## Continuidad LOCAL-LAUNCHER-LIBRARY-POLISH-STATUS-FAVORITES-8

El tile vigente de `Iconos` queda en `122px` para conservar 2/4 columnas con el
scrollbar reservado. La fila de orden suma un boton `Todos/Favoritos` y el
select de criterio guarda preferencias con debounce. El copy visible pasa a
`Añadir ubicación` / `Cambiar ubicación` y `Filtros`.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CORRECTION-BADGES-SCROLL-9

El select no colorea `option:checked`; solo se intenta tematizar `option:hover`.
Los badges tecnicos dejan de mostrarse en biblioteca y se usa `ABIERTO` como
placeholder de semana.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS,
membership, scoped queue, auto-sync, contrato de packs, catalogo, descargas,
competicion v2, menu de cuenta, footer, panel derecho, favoritos scoped ni
actividad local.
