# LOCAL-LAUNCHER-LIBRARY-RESPONSIVE-AUTH-GUARDS-4

Anclaje superior, responsive real por vista y guardas sin sesion.

## Biblioteca Arriba

La zona de packs queda anclada arriba bajo los controles. Los grupos y grids
usan `align-content: start` y el scroll vive en la zona de packs, de modo que el
espacio vacio sobrante queda debajo.

## Responsive Por Vista

La biblioteca usa container queries sobre `.library-panel`.

- `Portadas`: dos columnas en ancho suficiente, bajando a una columna cuando el
  contenedor cruza el breakpoint comun de 340px. La caratula mantiene
  `aspect-ratio: 2 / 3`.
- `Lista`: fila horizontal compacta de altura controlada, con miniatura 1/1,
  estrella, texto y estado alineados.
- `Iconos`: grid anclado arriba con tile fijo 1/1 de 92px.

Los controles superiores se adaptan: `Cambiar directorio` va a la izquierda y
`Más filtros` a la derecha. `Más filtros` solo usa acento circuito abierto. En
sidebar estrecha se apilan, con `Cambiar directorio` arriba. Los botones
`Portadas`, `Lista`, `Iconos` conservan `aria-label`/`title` y muestran solo
icono en el mismo breakpoint de 340px.

## Continuidad LOCAL-LAUNCHER-LIBRARY-BREAKPOINT-POLISH-5

El breakpoint comun queda fijado en `340px` y la sidebar minima baja a `320px`.
Ese breakpoint coordina el paso de `Portadas` a una columna con los botones de
vista en modo solo icono. `Iconos` mantiene tile fijo de 92px.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CONTROLS-FIX-SORT-6

El modo solo icono oculta unicamente el label de los botones de vista. La
tarjeta `Más filtros` incorpora ordenacion compacta; solo `Semanas` agrupa por
temporada, mientras `Alfabético`, `Desarrollador` y `Año` renderizan lista
plana despues de aplicar busqueda y temporada.

## Guardas Sin Sesion

Los favoritos son preferencia de jugador autenticado:

- sin sesion, la estrella queda deshabilitada;
- el renderer no llama al toggle;
- el servicio rechaza la accion;
- no se escriben favoritos nuevos en `userData/library/favorites.json`.

El archivo antiguo `userData/library/favorites.json` queda como legado si ya
existe. No se borra automaticamente, pero la UI normal sin sesion no lo usa como
perfil editable.

Sin sesion, Actividad local muestra un estado neutro:

```text
Inicia sesión para ver tu actividad local.
```

No se muestra el estado normal `Sincronizado` vacio ni el boton `Ver detalles`.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS, membership,
scoped queue, auto-sync, contrato de packs, catalogo, descarga, competicion v2,
cuenta, footer, panel derecho salvo la tarjeta de actividad, ni `config.json`.

## Pendiente

- Validar visualmente con GUI real en sidebar estrecha, media y ancha con varios
  packs y assets variados.
