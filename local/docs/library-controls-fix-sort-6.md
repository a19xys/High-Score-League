# LOCAL-LAUNCHER-LIBRARY-CONTROLS-FIX-SORT-6

Correccion de controles compactos y ordenacion basica de biblioteca.

## Controles

`Mas filtros` usa el estado real `libraryFiltersOpen`:

- cerrado: boton neutro, igual que `Cambiar directorio`;
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
[Cambiar directorio] [Mas filtros]
```

Si se apilan, `Cambiar directorio` queda arriba.

## Espaciado

El gap bajo `Biblioteca` se compacta reduciendo el gap de `.library-panel` y
eliminando el margen inferior de la cabecera dentro del panel de biblioteca.

## Ordenar

La tarjeta `Mas filtros` incluye la seccion compacta `ORDENAR` con:

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

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS,
membership, scoped queue, auto-sync, contrato de packs, catalogo, descargas,
competicion v2, menu de cuenta, footer, panel derecho, favoritos scoped ni
actividad local.
