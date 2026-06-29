# LOCAL-LAUNCHER-LIBRARY-MICROPOLISH-SORT-SCROLL-7

Microajustes de biblioteca, ordenacion y scroll.

## Iconos

La vista `Iconos` sube el tile fijo a:

```text
122px
```

Con la sidebar minima de `320px`, el contenido util permite 2 iconos por fila
con `8px` de gap horizontal y aire junto al scrollbar. Con la sidebar maxima de `600px`,
entran 4 iconos por fila sin cambiar `LIBRARY_SIDEBAR_MAX`.

El tile mantiene `aspect-ratio: 1 / 1`, el nombre usa el mismo ancho del tile y
se limita a dos lineas.

## Ordenar

La seccion `ORDENAR` elimina los labels visibles `Criterio` y `Direccion`.
Queda:

```text
ORDENAR
[Semanas................] [icono arriba/abajo]
```

El criterio sigue siendo un `select` con:

- `Semanas`
- `Alfabetico`
- `Desarrollador`
- `Ano`

La direccion deja de ser un `select` y pasa a ser un boton estrecho. Usa:

```text
arrow-up.svg
arrow-down.svg
```

Si esos SVG no existen, el sistema local de iconos muestra fallback discreto.
El boton alterna `librarySortDirection` entre `asc` y `desc` y mantiene la
persistencia existente.

## Scrollbars

Solo en modo oscuro, los scrollbars usan color circuito:

- `scrollbar-color` para navegadores compatibles;
- `::-webkit-scrollbar` para Electron/Chromium.

El modo claro no recibe override especifico.

La zona scrollable de packs anade `padding-right: 10px` y
`scrollbar-gutter: stable` para separar contenido y scrollbar sin provocar
scroll horizontal.

## Controles

Los controles de biblioteca suben ligeramente:

- botones principales y vistas: `35px` de alto y `12.5px`;
- busqueda, temporada, criterio y toggle de direccion: `35px` de alto y `13px`.

El gap bajo `Biblioteca` queda en un punto intermedio: mas aire que el ajuste
anterior, sin volver al hueco grande inicial.

Los botones `Portadas`, `Lista` e `Iconos` centran icono y label como conjunto.
En modo estrecho se oculta solo el label y el icono queda centrado.

## Scroll De Actividad

El renderer conserva `scrollTop` de `.game-scroll` y `.library-section--packs`
antes de reconstruir el DOM y lo restaura despues del render. Abrir o cerrar
`Actividad local` ya no debe subir el panel derecho al inicio.

## Continuidad LOCAL-LAUNCHER-LIBRARY-POLISH-STATUS-FAVORITES-8

La zona de packs reserva scrollbar siempre con `overflow-y: scroll`. La vista
`Iconos` baja a `122px` para asegurar 2 columnas en sidebar minima y 4 en
maxima con gutter estable. La tarjeta `ORDENAR` suma un toggle local
`Todos/Favoritos`; el criterio de orden se persiste con debounce para no
interferir con el `select` nativo.

## Continuidad LOCAL-LAUNCHER-LIBRARY-CORRECTION-BADGES-SCROLL-9

El tile vigente de `Iconos` queda en `122px`. El scrollbar nativo conserva el
carril y se añade un indicador visual para el caso sin overflow. La biblioteca
deja de mostrar badges tecnicos y usa `ABIERTO` como placeholder de semana.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, payloads, endpoints, RLS,
membership, scoped queue, auto-sync, contrato de packs, catalogo, descargas,
competicion v2, menu de cuenta, favoritos scoped ni bloqueo sin sesion.

## Pendiente

Validar visualmente en Electron con sidebar minima, media y maxima usando packs
con assets reales y nombres largos.
