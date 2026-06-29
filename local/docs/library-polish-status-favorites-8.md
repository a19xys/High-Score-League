# LOCAL-LAUNCHER-LIBRARY-POLISH-STATUS-FAVORITES-8

Pulido de biblioteca: scroll, favoritos, controles y estados visuales.

## Scroll

La zona `.library-section--packs` usa `overflow-y: scroll` y
`scrollbar-gutter: stable`. La barra queda reservada siempre, de modo que el
contenido no se desplaza cuando la lista pasa de caber a necesitar scroll.

## Iconos

La vista `Iconos` mantiene tile fijo 1/1 y queda en:

```text
122px
```

Con sidebar minima de `320px`, entran 2 iconos por fila. Con sidebar maxima de
`600px`, entran 4 iconos por fila. El gap efectivo es `12px 8px`; no cambia
`LIBRARY_SIDEBAR_MAX`.

## Favoritos

La estrella de cada pack sigue bloqueada sin sesion. Visualmente queda como
boton cuadrado con `border-radius: 8px`, no circular.

La tarjeta de filtros incorpora un boton local `Todos/Favoritos` junto al
orden. Si no hay sesion queda deshabilitado. Si hay sesion, alterna entre todos
los packs y los packs con `pack.favorite`.

Este filtro no cambia el storage de favoritos. Sigue usando favoritos scoped por
cuenta activa.

## Controles

- El boton de carpeta muestra `Añadir ubicación` si no hay directorio y
  `Cambiar ubicación` si ya hay uno.
- El boton `Filtros` reemplaza el copy largo anterior.
- Ambos usan iconos locales SVG (`folder.svg` y `filter.svg`) con fallback
  discreto.
- El selector de orden persiste con debounce para evitar re-render inmediato
  que pueda interferir con el cambio nativo del `select`.
- `LOCAL-LAUNCHER-LIBRARY-CORRECTION-BADGES-SCROLL-9` corrige el select:
  se intenta tematizar `option:hover`, no `option:checked`.

## Cards

- Las etiquetas de estado son mas grandes y usan borde con `currentColor`.
- Se reservan clases futuras para semana: `week-status--open`,
  `week-status--ending` y `week-status--closed`.
- El icono de calendario y el texto de semana se alinean en la misma linea.
- `LOCAL-LAUNCHER-LIBRARY-CORRECTION-BADGES-SCROLL-9` deja un unico badge
  visible `ABIERTO` en biblioteca y mueve `INSTALADO`/`LEGACY` al detalle
  futuro.
- En `Portadas`, las cards se igualan por fila sin reservar siempre dos lineas
  cuando todos los titulos son cortos.

## Futuro Documentado

Queda solo documentado, no implementado:

- estados de semana `Abierto`, `Acabando`, `Cerrado`;
- acciones `Instalar`, `Reinstalar` y `Jugar` segun estado del pack;
- desinstalacion de packs;
- regalos sorpresa.

## Fuera De Alcance

No se toca MAME, runtime, plugin, captura, backend, payloads, endpoints, RLS,
membership, scoped queue, auto-sync, contrato de packs, catalogo ni logica de
instalacion.
